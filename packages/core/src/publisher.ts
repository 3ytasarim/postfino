import { and, eq, inArray, sql, schema, type Db } from "@sichttakt/db";
import { AppError, isAppError, type PostStatus } from "@sichttakt/shared";
import { isBlocking, ProviderError, type ProviderCallLog, type PublishInput } from "@sichttakt/social-adapters";
import { getChannelAuthForPublish, type AdapterRegistry } from "./channels";
import { toMediaInfo } from "./media";
import { emitEvent } from "./webhooks";
import { audit } from "./audit";
import { failJob, completeJob, type Job } from "./queue";
import type { Keyring } from "./crypto";
import type { StorageDriver } from "./storage";

// Publish pipeline for one post target. Guarantees:
// - exactly-once: conditional status flip SCHEDULED→PUBLISHING acts as a lock; published_posts has a unique
//   index per target; a crashed run is never blindly re-published (container status is checked first)
// - approval: a post requiring approval is never published unless approved_version == current_version
// - revoked channels / credentials stop publishing immediately
// - stale jobs (post edited after enqueue) are no-ops

export type PublisherDeps = {
  db: Db;
  ring: Keyring;
  registry: AdapterRegistry;
  storage: StorageDriver;
  mediaUrlTtlSeconds: number;
  pollIntervalMs?: number;
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

const STALE_PUBLISHING_MS = 10 * 60_000;

export type PublishOutcome = "published" | "notification_sent" | "skipped" | "blocked" | "retry" | "failed";

export async function processPublishJob(deps: PublisherDeps, job: Job): Promise<PublishOutcome> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const { postTargetId, version } = job.payload as { postTargetId: string; version: number };
  const [row] = await db
    .select({ target: schema.postTargets, post: schema.posts, ws: schema.workspaces })
    .from(schema.postTargets)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.postTargets.postId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.posts.workspaceId))
    .where(eq(schema.postTargets.id, postTargetId));
  if (!row) return done("skipped");
  const { target, post, ws } = row;
  const attemptNo = target.attempts + 1;
  const logs: ProviderCallLog[] = [];
  const record = async (step: string, outcome: string, extra: { errorCode?: string; request?: Record<string, unknown>; response?: Record<string, unknown> } = {}) => {
    await db.insert(schema.publishAttempts).values({ organizationId: post.organizationId, postTargetId: target.id, queueItemId: job.id, attempt: attemptNo, step, outcome, ...extra });
  };

  async function done(o: PublishOutcome) {
    await completeJob(db, job.id);
    return o;
  }

  // 1. Stale / irrelevant jobs
  if (version !== post.currentVersion) return done("skipped");
  if (["PUBLISHED", "CANCELLED", "NOTIFICATION_SENT", "FAILED_FINAL"].includes(target.status)) return done("skipped");
  if (target.scheduledAt && target.scheduledAt.getTime() > now.getTime() + 30_000) return done("skipped"); // rescheduled later; newer job exists

  // 2. Approval gate (never auto-publish unapproved content)
  if (ws.approvalRequired && post.approvedVersion !== post.currentVersion) {
    await record("approval_gate", "blocked", { errorCode: "APPROVAL_REQUIRED" });
    return done("blocked");
  }

  // 3. Queue paused → try again later without consuming an attempt
  if (ws.queuePaused) {
    await db.update(schema.queueItems).set({ status: "pending", runAt: new Date(now.getTime() + 5 * 60_000), attempts: sql`${schema.queueItems.attempts} - 1`, lockedBy: null, lockedUntil: null }).where(eq(schema.queueItems.id, job.id));
    return "retry";
  }

  // 4. Publish lock: conditional flip. A concurrently running duplicate sees 0 rows.
  const claimed = await db
    .update(schema.postTargets)
    .set({ status: "PUBLISHING", attempts: attemptNo, updatedAt: now })
    .where(and(eq(schema.postTargets.id, target.id), inArray(schema.postTargets.status, ["SCHEDULED", "FAILED_RETRYABLE", "APPROVED"])))
    .returning();
  if (!claimed[0]) {
    const stale = target.status === "PUBLISHING" && now.getTime() - target.updatedAt.getTime() > STALE_PUBLISHING_MS;
    if (!stale) return done("skipped");
    // crash recovery of a previous run: continue below, reusing the stored container id
    await db.update(schema.postTargets).set({ attempts: attemptNo, updatedAt: now }).where(eq(schema.postTargets.id, target.id));
  }
  await refreshPostStatus(db, post.id);

  try {
    const { channel, auth } = await getChannelAuthForPublish(db, deps.ring, target.channelId, deps.registry);

    // 5. Notification mode: no provider call, remind the team to post manually.
    if (target.publishMode === "notification") {
      const members = await db.select().from(schema.memberships).where(eq(schema.memberships.organizationId, post.organizationId));
      for (const m of members) {
        if (!m.userId || (m.workspaceId && m.workspaceId !== ws.id)) continue;
        await db.insert(schema.notifications).values({ organizationId: post.organizationId, workspaceId: ws.id, userId: m.userId, kind: "publish_reminder", title: `Manuell veröffentlichen: ${channel.displayName}`, body: post.caption.slice(0, 200), link: `/app/posts/${post.id}` });
      }
      await setTargetStatus(db, target.id, "NOTIFICATION_SENT");
      await record("notify", "ok");
      await refreshPostStatus(db, post.id);
      return done("notification_sent");
    }

    const adapter = deps.registry.get(channel.platform);

    // 6. Build provider input with short-lived signed URLs (never raw storage paths).
    const pm = await db.select({ role: schema.postMedia.role, position: schema.postMedia.position, asset: schema.mediaAssets }).from(schema.postMedia).innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, schema.postMedia.assetId)).where(eq(schema.postMedia.postId, post.id));
    const url = (key: string) => deps.storage.signedUrl(key, deps.mediaUrlTtlSeconds) ?? undefined;
    const pick = (role: string) => pm.filter((m) => m.role === role).sort((a, b) => a.position - b.position);
    const input: PublishInput = {
      type: post.type,
      caption: target.captionOverride ?? post.caption,
      media: pick("item").map((m) => toMediaInfo(m.asset, url(m.asset.storageKey))),
      video: pick("video")[0] ? toMediaInfo(pick("video")[0]!.asset, url(pick("video")[0]!.asset.storageKey)) : undefined,
      cover: pick("cover")[0] ? toMediaInfo(pick("cover")[0]!.asset, url(pick("cover")[0]!.asset.storageKey)) : undefined,
      thumbOffsetMs: post.thumbOffsetMs ?? undefined,
      options: target.options as PublishInput["options"],
    };
    const issues = adapter.validateContent(input).filter(isBlocking);
    if (issues.length) throw new AppError("MEDIA_INVALID", issues.map((i) => i.message).join("; "), issues);
    if (!adapter.isMock && [input.video, input.cover, ...input.media].some((m) => m && !m.publicUrl))
      throw new AppError("PROVIDER_NOT_CONFIGURED", "MEDIA_PUBLIC_BASE_URL is not configured — the provider cannot fetch media");

    const log = (l: ProviderCallLog) => logs.push(l);

    // 7. Container: reuse an existing one when resuming (provider-level dedup), else create.
    let containerId = target.externalContainerId;
    if (containerId) {
      const st = await adapter.getPublishStatus(auth, containerId, log);
      if (st === "published") {
        // Crash after provider publish but before we stored the id: do NOT publish again.
        throw new AppError("CONFLICT", "PUBLISH_RESULT_UNKNOWN: container already published, verify manually on the platform");
      }
      if (st === "expired" || st === "error") containerId = null;
    }
    if (!containerId) {
      await setTargetStatus(db, target.id, "PUBLISHING");
      ({ containerId } = await adapter.createMedia(auth, input, log));
      await db.update(schema.postTargets).set({ externalContainerId: containerId, updatedAt: new Date() }).where(eq(schema.postTargets.id, target.id));
    }

    // 8. Poll processing status.
    const maxPolls = deps.maxPolls ?? 20;
    const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    let status = await adapter.getPublishStatus(auth, containerId, log);
    for (let i = 0; status === "in_progress" && i < maxPolls; i++) {
      await sleep(deps.pollIntervalMs ?? 5_000);
      status = await adapter.getPublishStatus(auth, containerId, log);
    }
    if (status === "in_progress") throw new ProviderError("media still processing", true, "MEDIA_PROCESSING");
    if (status === "error") throw new ProviderError("provider rejected media during processing", false, "MEDIA_PROCESSING_ERROR");
    if (status === "expired") throw new ProviderError("container expired", true, "CONTAINER_EXPIRED");
    if (status === "published") throw new AppError("CONFLICT", "PUBLISH_RESULT_UNKNOWN: container already published");

    // 9. Publish + persist (unique index on published_posts.post_target_id is the last line of defence).
    if (containerId.startsWith("direct:") && target.externalContainerId === containerId) {
      // A previous run may have reached the provider for a single-call platform: never publish twice.
      throw new AppError("CONFLICT", "PUBLISH_RESULT_UNKNOWN: previous direct publish attempt did not complete, verify manually on the platform");
    }
    const { externalPostId } = await adapter.publish(auth, containerId, log, input);
    const permalink = await adapter.getPostUrl(auth, externalPostId).catch(() => null);
    const publishedAt = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(schema.publishedPosts).values({ organizationId: post.organizationId, workspaceId: ws.id, postTargetId: target.id, channelId: channel.id, platform: channel.platform, externalPostId, permalink, coverUrlSent: input.cover?.publicUrl ? "[signed-url]" : null, rawResponse: { logs: logs.length }, publishedAt });
      await tx.update(schema.postTargets).set({ status: "PUBLISHED", externalPostId, permalink, publishedAt, errorCode: null, errorMessage: null, updatedAt: publishedAt }).where(eq(schema.postTargets.id, target.id));
    });
    // First comment: best effort after a successful publish; failure is logged, the post stays published.
    const firstComment = (target.options as { firstComment?: string }).firstComment;
    if (firstComment && adapter.postFirstComment) {
      try {
        await adapter.postFirstComment(auth, externalPostId, firstComment, log);
      } catch (e) {
        await record("first_comment", "error", { errorCode: e instanceof ProviderError ? (e.providerCode ?? "PROVIDER_ERROR") : "INTERNAL" });
        await db.update(schema.postTargets).set({ errorCode: "FIRST_COMMENT_FAILED", errorMessage: (e as Error).message.slice(0, 500) }).where(eq(schema.postTargets.id, target.id));
      }
    }
    for (const l of logs) await record(l.step, "ok", { request: l.request, response: l.response });
    await refreshPostStatus(db, post.id);
    await audit(db, { organizationId: post.organizationId, workspaceId: ws.id, actorType: "system", action: "post.published", targetType: "post_target", targetId: target.id, metadata: { platform: channel.platform, externalPostId, mock: adapter.isMock } });
    await emitEvent(db, { organizationId: post.organizationId, workspaceId: ws.id, event: "post.published", data: { post_id: post.id, account_id: channel.id, external_post_id: externalPostId, permalink, sandbox: adapter.isMock } });
    return done("published");
  } catch (e) {
    for (const l of logs) await record(l.step, "error", { request: l.request, response: l.response });
    const retryable = e instanceof ProviderError ? e.retryable : false;
    // A direct-publish marker is cleared only when the provider definitively answered (request not executed);
    // network errors and crashes keep it so the next run reports PUBLISH_RESULT_UNKNOWN instead of posting twice.
    if (e instanceof ProviderError && e.providerCode !== "NETWORK")
      await db.update(schema.postTargets).set({ externalContainerId: null }).where(and(eq(schema.postTargets.id, target.id), sql`${schema.postTargets.externalContainerId} like 'direct:%'`));
    const code = e instanceof ProviderError ? (e.providerCode ?? "PROVIDER_ERROR") : isAppError(e) ? e.code : "INTERNAL";
    const message = (e as Error).message.slice(0, 1000);
    const { dead } = await failJob(db, job, `${code}: ${message}`, { retryable });
    const finalStatus: PostStatus = dead ? "FAILED_FINAL" : "FAILED_RETRYABLE";
    await db.update(schema.postTargets).set({ status: finalStatus, errorCode: code, errorMessage: message, updatedAt: new Date() }).where(eq(schema.postTargets.id, target.id));
    await record("result", dead ? "final_error" : "retryable_error", { errorCode: code });
    await refreshPostStatus(db, post.id);
    if (dead) {
      await emitEvent(db, { organizationId: post.organizationId, workspaceId: ws.id, event: "post.failed", data: { post_id: post.id, post_target_id: target.id, account_id: target.channelId, error_code: code, error_message: message, action_required: true } });
      if (code === "MEDIA_INVALID") await emitEvent(db, { organizationId: post.organizationId, workspaceId: ws.id, event: "media.failed", data: { post_id: post.id, error_message: message } });
    }
    return dead ? "failed" : "retry";
  }
}

async function setTargetStatus(db: Db, id: string, status: PostStatus) {
  await db.update(schema.postTargets).set({ status, updatedAt: new Date() }).where(eq(schema.postTargets.id, id));
}

/** Post status derives from its targets. */
export async function refreshPostStatus(db: Db, postId: string) {
  const ts = await db.select({ status: schema.postTargets.status }).from(schema.postTargets).where(eq(schema.postTargets.postId, postId));
  const s = new Set(ts.map((t) => t.status));
  let status: PostStatus | null = null;
  if (s.has("PUBLISHING")) status = "PUBLISHING";
  else if (s.has("FAILED_RETRYABLE")) status = "FAILED_RETRYABLE";
  else if ([...s].every((x) => x === "PUBLISHED" || x === "NOTIFICATION_SENT" || x === "CANCELLED") && (s.has("PUBLISHED") || s.has("NOTIFICATION_SENT")))
    status = s.has("PUBLISHED") ? "PUBLISHED" : "NOTIFICATION_SENT";
  else if (s.has("FAILED_FINAL") && !s.has("SCHEDULED")) status = "FAILED_FINAL";
  if (status) await db.update(schema.posts).set({ status, updatedAt: new Date() }).where(eq(schema.posts.id, postId));
}
