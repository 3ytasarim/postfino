import { and, eq, gte, inArray, isNull, lte, schema, type Db } from "@sichttakt/db";
import { AppError, type PostStatus, type PostType, type PublishMode, type CreatePostInput, type UpdatePostInput, isValidTimeZone } from "@sichttakt/shared";
import { AUTOMATIC_STATES, isBlocking, type CapabilityKey, type ValidationIssue } from "@sichttakt/social-adapters";
import { sha256 } from "./crypto";
import { stableStringify } from "./util";
import { loadWorkspace, authorize } from "./tenancy";
import { loadAssetsInWorkspace, toMediaInfo } from "./media";
import { effectiveCapability, type AdapterRegistry } from "./channels";
import { assertFeature } from "./entitlements";
import { enqueue } from "./queue";
import { emitEvent } from "./webhooks";
import { audit } from "./audit";
import type { Actor } from "./rbac";

// ── State machine ──
const TRANSITIONS: Record<PostStatus, PostStatus[]> = {
  IDEA: ["DRAFT", "CANCELLED"],
  DRAFT: ["PENDING_APPROVAL", "APPROVED", "SCHEDULED", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "CHANGES_REQUESTED", "DRAFT", "CANCELLED"],
  CHANGES_REQUESTED: ["DRAFT", "PENDING_APPROVAL", "CANCELLED"],
  APPROVED: ["SCHEDULED", "PENDING_APPROVAL", "DRAFT", "CANCELLED"],
  SCHEDULED: ["PREPARING_MEDIA", "PUBLISHING", "PENDING_APPROVAL", "DRAFT", "CANCELLED", "NOTIFICATION_SENT"],
  PREPARING_MEDIA: ["PUBLISHING", "FAILED_RETRYABLE", "FAILED_FINAL", "CANCELLED"],
  PUBLISHING: ["PUBLISHED", "FAILED_RETRYABLE", "FAILED_FINAL"],
  PUBLISHED: [],
  FAILED_RETRYABLE: ["PUBLISHING", "PREPARING_MEDIA", "FAILED_FINAL", "CANCELLED", "SCHEDULED"],
  FAILED_FINAL: ["DRAFT", "SCHEDULED", "CANCELLED"],
  NOTIFICATION_SENT: ["PUBLISHED", "CANCELLED"],
  CANCELLED: ["DRAFT"],
};

export const canTransition = (from: PostStatus, to: PostStatus) => TRANSITIONS[from].includes(to);
function assertTransition(from: PostStatus, to: PostStatus) {
  if (!canTransition(from, to)) throw new AppError("INVALID_STATE_TRANSITION", `Cannot move post from ${from} to ${to}`);
}

const TYPE_CAPABILITY: Record<PostType, CapabilityKey> = {
  text: "post.text",
  image: "post.image",
  video: "post.video",
  carousel: "post.carousel",
  story: "post.story",
  reel: "post.reel",
  short: "post.short",
  document: "post.document",
  thread: "post.thread",
};

type Post = typeof schema.posts.$inferSelect;

/** The content fingerprint used for approval invalidation: any change here requires re-approval. */
/** Provider options per target (wire snake_case → adapter camelCase). */
function targetOptions(o: { share_to_feed?: boolean; first_comment?: string; title?: string; privacy?: string; link?: string } | undefined) {
  return { shareToFeed: o?.share_to_feed, firstComment: o?.first_comment, title: o?.title, privacy: o?.privacy, link: o?.link };
}

export function contentSnapshot(post: Pick<Post, "caption" | "type" | "coverMode" | "thumbOffsetMs" | "scheduledAt">, mediaIds: Record<string, string[]>, targets: { channelId: string; captionOverride: string | null; options: unknown }[]) {
  return {
    type: post.type,
    caption: post.caption,
    coverMode: post.coverMode,
    thumbOffsetMs: post.thumbOffsetMs,
    media: mediaIds,
    targets: [...targets].sort((a, b) => a.channelId.localeCompare(b.channelId)).map((t) => ({ c: t.channelId, cap: t.captionOverride, o: t.options })),
  };
}

export type CreatePostResult = { post: ReturnType<typeof postView>; validation: Record<string, ValidationIssue[]> };

export async function createPost(db: Db, registry: AdapterRegistry, actor: Actor, input: CreatePostInput, opts: { now?: Date } = {}): Promise<CreatePostResult> {
  const ws = await loadWorkspace(db, actor, input.workspace_id, "posts.write");
  const now = opts.now ?? new Date();

  // Channels must be in the same workspace and active.
  const chans = await db
    .select()
    .from(schema.channels)
    .where(and(inArray(schema.channels.id, input.account_ids), eq(schema.channels.organizationId, actor.organizationId), eq(schema.channels.workspaceId, ws.id), isNull(schema.channels.disconnectedAt)));
  if (chans.length !== new Set(input.account_ids).size) throw new AppError("NOT_FOUND", "One or more accounts not found in this workspace");

  // Media strictly from this workspace; video and cover must be distinct assets.
  const itemIds = input.media_asset_ids;
  const videoId = input.video_asset_id;
  const coverId = input.cover_asset_id;
  if (videoId && coverId && videoId === coverId) throw new AppError("MEDIA_INVALID", "video_asset_id and cover_asset_id must be different files");
  const assets = await loadAssetsInWorkspace(db, actor.organizationId, ws.id, [...itemIds, ...(videoId ? [videoId] : []), ...(coverId ? [coverId] : [])]);
  const byId = new Map(assets.map((a) => [a.id, a]));
  for (const a of assets) if (a.status !== "ready") throw new AppError("MEDIA_INVALID", `Media ${a.id} is not ready (${a.status})`, { asset_id: a.id, errors: a.validationErrors });
  if (coverId) {
    const cover = byId.get(coverId)!;
    if (cover.kind !== "image") throw new AppError("MEDIA_INVALID", "cover_asset_id must be an image");
    await assertFeature(db, actor.organizationId, "independent_reel_cover");
  }
  if (videoId && byId.get(videoId)!.kind !== "video") throw new AppError("MEDIA_INVALID", "video_asset_id must be a video");

  // Schedule time: must carry an offset, must be in the future, stored as UTC.
  let scheduledAt: Date | null = null;
  if (input.scheduled_at) {
    scheduledAt = new Date(input.scheduled_at);
    if (Number.isNaN(scheduledAt.getTime())) throw new AppError("VALIDATION_FAILED", "Invalid scheduled_at");
    if (scheduledAt.getTime() < now.getTime() + 60_000) throw new AppError("VALIDATION_FAILED", "scheduled_at must be at least 1 minute in the future");
  }
  // Queue mode: each target gets the next free posting slot of its own channel (validated before persisting).
  const slotFor = new Map<string, Date>();
  if (input.queue) {
    const { nextFreeSlot } = await import("./scheduling");
    for (const c of chans) slotFor.set(c.id, await nextFreeSlot(db, c.id, { now }));
    scheduledAt = new Date(Math.min(...[...slotFor.values()].map((d) => d.getTime())));
  }
  const tz = input.timezone ?? ws.timezone;
  if (!isValidTimeZone(tz)) throw new AppError("VALIDATION_FAILED", `Unknown timezone ${tz}`);

  // Capability + content validation per channel, BEFORE anything is persisted or sent to a provider.
  const validation: Record<string, ValidationIssue[]> = {};
  const targetModes: Record<string, PublishMode> = {};
  for (const ch of chans) {
    const override = input.targets?.find((t) => t.account_id === ch.id);
    const manualOnly = (ch.meta as { manual?: boolean } | null)?.manual === true;
    const mode: PublishMode = manualOnly ? "notification" : (override?.publish_mode ?? input.publish_mode);
    const typeState = await effectiveCapability(db, ch.platform, ch.id, TYPE_CAPABILITY[input.type]);
    if (typeState === "unsupported") throw new AppError("CAPABILITY_NOT_SUPPORTED", `${ch.platform} does not support post type "${input.type}"`, { account_id: ch.id, capability: TYPE_CAPABILITY[input.type] });
    if (typeState === "requires_manual_notification" || typeState === "unverified") {
      if (mode === "automatic") throw new AppError("CAPABILITY_NOT_SUPPORTED", `${ch.platform} "${input.type}" cannot be published automatically (${typeState}); use publish_mode=notification`, { account_id: ch.id, state: typeState });
    }
    if (coverId) {
      const coverState = await effectiveCapability(db, ch.platform, ch.id, "reel.independent_cover");
      if (!AUTOMATIC_STATES.includes(coverState) && mode === "automatic")
        throw new AppError("CAPABILITY_NOT_SUPPORTED", `Independent Reels cover is "${coverState}" for this account. Use publish_mode=notification (set cover in the Instagram app) or video_frame cover until the live PoC verifies it.`, {
          account_id: ch.id,
          capability: "reel.independent_cover",
          state: coverState,
          alternatives: ["notification", "video_frame"],
        });
    }
    if (override?.first_comment) {
      await assertFeature(db, actor.organizationId, "first_comment");
      const fcState = await effectiveCapability(db, ch.platform, ch.id, "post.first_comment");
      if (!AUTOMATIC_STATES.includes(fcState) && mode === "automatic")
        throw new AppError("CAPABILITY_NOT_SUPPORTED", `First comment is "${fcState}" for ${ch.platform}`, { account_id: ch.id, capability: "post.first_comment", state: fcState });
    }
    targetModes[ch.id] = mode;
    const adapter = registry.get(ch.platform);
    const issues = adapter.validateContent({
      type: input.type,
      caption: override?.caption ?? input.caption,
      media: itemIds.map((i) => toMediaInfo(byId.get(i)!)),
      video: videoId ? toMediaInfo(byId.get(videoId)!) : undefined,
      cover: coverId ? toMediaInfo(byId.get(coverId)!) : undefined,
      thumbOffsetMs: input.thumb_offset_ms,
      options: targetOptions(override),
    });
    validation[ch.id] = issues;
    if (issues.some(isBlocking)) throw new AppError("MEDIA_INVALID", "Content does not meet platform requirements", { account_id: ch.id, issues });
  }

  let status: PostStatus = "DRAFT";
  if (input.status === "scheduled") status = ws.approvalRequired ? "PENDING_APPROVAL" : "SCHEDULED";

  const mediaIds = { item: itemIds, video: videoId ? [videoId] : [], cover: coverId ? [coverId] : [] };
  const result = await db.transaction(async (tx) => {
    const [post] = await tx
      .insert(schema.posts)
      .values({
        organizationId: actor.organizationId,
        workspaceId: ws.id,
        type: input.type,
        status,
        caption: input.caption,
        coverMode: input.type === "reel" ? (coverId ? "independent_image" : (input.cover_mode ?? "video_frame")) : null,
        thumbOffsetMs: input.thumb_offset_ms ?? null,
        scheduledAt,
        scheduledTimezone: tz,
        tags: input.tags ?? [],
        externalRef: input.external_ref,
        createdByUserId: actor.kind === "user" ? actor.userId : null,
        createdViaApiKeyId: actor.kind === "api_key" ? actor.apiKeyId : null,
      })
      .returning();
    const targets = await tx
      .insert(schema.postTargets)
      .values(
        chans.map((c) => {
          const o = input.targets?.find((t) => t.account_id === c.id);
          return {
            organizationId: actor.organizationId,
            postId: post!.id,
            channelId: c.id,
            status,
            publishMode: targetModes[c.id]!,
            captionOverride: o?.caption ?? null,
            options: targetOptions(o),
            scheduledAt: slotFor.get(c.id) ?? scheduledAt,
          };
        }),
      )
      .returning();
    const pm: (typeof schema.postMedia.$inferInsert)[] = [
      ...itemIds.map((a, i) => ({ postId: post!.id, assetId: a, organizationId: actor.organizationId, role: "item", position: i })),
      ...(videoId ? [{ postId: post!.id, assetId: videoId, organizationId: actor.organizationId, role: "video", position: 0 }] : []),
      ...(coverId ? [{ postId: post!.id, assetId: coverId, organizationId: actor.organizationId, role: "cover", position: 0 }] : []),
    ];
    if (pm.length) await tx.insert(schema.postMedia).values(pm);
    const snap = contentSnapshot(post!, mediaIds, targets);
    await tx.insert(schema.postVersions).values({
      organizationId: actor.organizationId,
      postId: post!.id,
      version: 1,
      snapshot: snap,
      contentHash: sha256(stableStringify(snap)),
      changedByUserId: actor.kind === "user" ? actor.userId : null,
      changedViaApiKeyId: actor.kind === "api_key" ? actor.apiKeyId : null,
    });
    if (status === "PENDING_APPROVAL")
      await tx.insert(schema.approvalRequests).values({ organizationId: actor.organizationId, workspaceId: ws.id, postId: post!.id, postVersion: 1, requestedByUserId: actor.kind === "user" ? actor.userId : null });
    return { post: post!, targets };
  });

  if (status === "SCHEDULED") await scheduleTargets(db, result.post, result.targets);
  await audit(db, { organizationId: actor.organizationId, workspaceId: ws.id, actor, action: "post.created", targetType: "post", targetId: result.post.id, metadata: { status, type: input.type, targets: chans.length } });
  await emitEvent(db, { organizationId: actor.organizationId, workspaceId: ws.id, event: "post.created", data: { post_id: result.post.id, status, external_ref: input.external_ref ?? null } });
  if (status === "SCHEDULED") await emitEvent(db, { organizationId: actor.organizationId, workspaceId: ws.id, event: "post.scheduled", data: { post_id: result.post.id, scheduled_at: scheduledAt?.toISOString() } });
  return { post: postView(result.post, result.targets), validation };
}

async function scheduleTargets(db: Db, post: Post, targets: (typeof schema.postTargets.$inferSelect)[]) {
  for (const t of targets) {
    if (t.status !== "SCHEDULED") continue;
    // dedup key includes version: rescheduling/editing creates a new job, stale jobs no-op in the worker.
    await enqueue(db, {
      kind: "publish_target",
      organizationId: post.organizationId,
      payload: { postTargetId: t.id, version: post.currentVersion },
      dedupKey: `publish:${t.id}:v${post.currentVersion}:${(t.scheduledAt ?? post.scheduledAt)?.toISOString() ?? "now"}`,
      runAt: t.scheduledAt ?? post.scheduledAt ?? new Date(),
      maxAttempts: 6,
    });
  }
}

export async function getPost(db: Db, actor: Actor, postId: string) {
  const [post] = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.id, postId), eq(schema.posts.organizationId, actor.organizationId), isNull(schema.posts.deletedAt)));
  if (!post) throw new AppError("NOT_FOUND", "Post not found");
  authorize(actor, post.workspaceId, "posts.read", post.organizationId);
  const targets = await db.select().from(schema.postTargets).where(eq(schema.postTargets.postId, post.id));
  const media = await db.select().from(schema.postMedia).where(eq(schema.postMedia.postId, post.id));
  return { post, targets, media };
}

/** Edits bump the version; a content change on an approved/scheduled post invalidates approval. */
export async function updatePost(db: Db, actor: Actor, postId: string, input: UpdatePostInput, opts: { now?: Date } = {}) {
  const { post, targets, media } = await getPost(db, actor, postId);
  authorize(actor, post.workspaceId, "posts.write");
  if (["PUBLISHING", "PUBLISHED", "PREPARING_MEDIA"].includes(post.status)) throw new AppError("INVALID_STATE_TRANSITION", `Cannot edit a post in status ${post.status}`);
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, post.workspaceId));
  const now = opts.now ?? new Date();

  const mediaIds = {
    item: input.media_asset_ids ?? media.filter((m) => m.role === "item").sort((a, b) => a.position - b.position).map((m) => m.assetId),
    video: input.video_asset_id ? [input.video_asset_id] : media.filter((m) => m.role === "video").map((m) => m.assetId),
    cover: input.cover_asset_id === null ? [] : input.cover_asset_id ? [input.cover_asset_id] : media.filter((m) => m.role === "cover").map((m) => m.assetId),
  };
  await loadAssetsInWorkspace(db, actor.organizationId, post.workspaceId, [...mediaIds.item, ...mediaIds.video, ...mediaIds.cover]);
  if (mediaIds.video[0] && mediaIds.video[0] === mediaIds.cover[0]) throw new AppError("MEDIA_INVALID", "video and cover must be different files");

  let scheduledAt = post.scheduledAt;
  if (input.scheduled_at !== undefined) {
    scheduledAt = input.scheduled_at ? new Date(input.scheduled_at) : null;
    if (scheduledAt && scheduledAt.getTime() < now.getTime() + 60_000) throw new AppError("VALIDATION_FAILED", "scheduled_at must be at least 1 minute in the future");
  }
  const next = {
    ...post,
    caption: input.caption ?? post.caption,
    coverMode: post.type === "reel" ? (mediaIds.cover.length ? ("independent_image" as const) : ("video_frame" as const)) : post.coverMode,
    scheduledAt,
  };
  const snap = contentSnapshot(next, mediaIds, targets);
  const hash = sha256(stableStringify(snap));
  const [prev] = await db.select().from(schema.postVersions).where(and(eq(schema.postVersions.postId, post.id), eq(schema.postVersions.version, post.currentVersion)));
  const contentChanged = prev?.contentHash !== hash;
  const version = contentChanged ? post.currentVersion + 1 : post.currentVersion;

  let status: PostStatus = post.status;
  const wasApproved = post.approvedVersion !== null && ["APPROVED", "SCHEDULED"].includes(post.status);
  if (contentChanged && wasApproved && ws!.approvalRequired) status = "PENDING_APPROVAL"; // re-approval required
  if (status === "CANCELLED") status = "DRAFT";

  await db.transaction(async (tx) => {
    await tx
      .update(schema.posts)
      .set({ caption: next.caption, coverMode: next.coverMode, scheduledAt, tags: input.tags ?? post.tags, currentVersion: version, status, approvedVersion: status === "PENDING_APPROVAL" ? null : post.approvedVersion, updatedAt: now })
      .where(eq(schema.posts.id, post.id));
    await tx.update(schema.postTargets).set({ status, scheduledAt, updatedAt: now }).where(and(eq(schema.postTargets.postId, post.id), inArray(schema.postTargets.status, ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "CHANGES_REQUESTED", "CANCELLED", "FAILED_FINAL"])));
    if (contentChanged) {
      await tx.delete(schema.postMedia).where(eq(schema.postMedia.postId, post.id));
      const pm = [
        ...mediaIds.item.map((a, i) => ({ postId: post.id, assetId: a, organizationId: post.organizationId, role: "item", position: i })),
        ...mediaIds.video.map((a) => ({ postId: post.id, assetId: a, organizationId: post.organizationId, role: "video", position: 0 })),
        ...mediaIds.cover.map((a) => ({ postId: post.id, assetId: a, organizationId: post.organizationId, role: "cover", position: 0 })),
      ];
      if (pm.length) await tx.insert(schema.postMedia).values(pm);
      await tx.insert(schema.postVersions).values({ organizationId: post.organizationId, postId: post.id, version, snapshot: snap, contentHash: hash, changedByUserId: actor.kind === "user" ? actor.userId : null, changedViaApiKeyId: actor.kind === "api_key" ? actor.apiKeyId : null });
      await tx.update(schema.approvalRequests).set({ status: "invalidated", closedAt: now }).where(and(eq(schema.approvalRequests.postId, post.id), eq(schema.approvalRequests.status, "open")));
      if (status === "PENDING_APPROVAL") await tx.insert(schema.approvalRequests).values({ organizationId: post.organizationId, workspaceId: post.workspaceId, postId: post.id, postVersion: version });
    }
  });
  const fresh = await getPost(db, actor, post.id);
  if (status === "SCHEDULED") await scheduleTargets(db, fresh.post, fresh.targets);
  await audit(db, { organizationId: post.organizationId, workspaceId: post.workspaceId, actor, action: "post.updated", targetType: "post", targetId: post.id, metadata: { version, contentChanged, reapprovalRequired: status === "PENDING_APPROVAL" && wasApproved } });
  return postView(fresh.post, fresh.targets);
}

export async function submitForApproval(db: Db, actor: Actor, postId: string) {
  const { post } = await getPost(db, actor, postId);
  authorize(actor, post.workspaceId, "posts.write");
  assertTransition(post.status, "PENDING_APPROVAL");
  await db.update(schema.posts).set({ status: "PENDING_APPROVAL", approvedVersion: null }).where(eq(schema.posts.id, post.id));
  await db.update(schema.postTargets).set({ status: "PENDING_APPROVAL" }).where(eq(schema.postTargets.postId, post.id));
  await db.insert(schema.approvalRequests).values({ organizationId: post.organizationId, workspaceId: post.workspaceId, postId: post.id, postVersion: post.currentVersion, requestedByUserId: actor.kind === "user" ? actor.userId : null });
  return (await getPost(db, actor, postId)).post;
}

export async function decideApproval(db: Db, actor: Actor, postId: string, decision: "approved" | "changes_requested", comment?: string, meta: { via?: "app" | "portal" | "api"; reviewerName?: string } = {}) {
  const { post } = await getPost(db, actor, postId);
  authorize(actor, post.workspaceId, "posts.approve");
  if (post.status !== "PENDING_APPROVAL") throw new AppError("INVALID_STATE_TRANSITION", `Post is ${post.status}, not pending approval`);
  const [req] = await db
    .select()
    .from(schema.approvalRequests)
    .where(and(eq(schema.approvalRequests.postId, post.id), eq(schema.approvalRequests.status, "open"), eq(schema.approvalRequests.postVersion, post.currentVersion)));
  if (!req) throw new AppError("CONFLICT", "No open approval request for the current version");
  // After approval: scheduled time present → SCHEDULED, otherwise APPROVED.
  const nextStatus: PostStatus = decision === "approved" ? (post.scheduledAt ? "SCHEDULED" : "APPROVED") : "CHANGES_REQUESTED";
  await db.transaction(async (tx) => {
    await tx.insert(schema.approvalDecisions).values({ organizationId: post.organizationId, approvalRequestId: req.id, decidedByUserId: actor.kind === "user" ? actor.userId : null, decidedViaApiKeyId: actor.kind === "api_key" ? actor.apiKeyId : null, decision, comment, via: meta.via ?? (actor.kind === "api_key" ? "api" : "app"), reviewerName: meta.reviewerName });
    await tx.update(schema.approvalRequests).set({ status: decision, closedAt: new Date(), reviewTokenHash: null }).where(eq(schema.approvalRequests.id, req.id));
    await tx.update(schema.posts).set({ status: nextStatus, approvedVersion: decision === "approved" ? post.currentVersion : null, updatedAt: new Date() }).where(eq(schema.posts.id, post.id));
    await tx.update(schema.postTargets).set({ status: nextStatus, updatedAt: new Date() }).where(and(eq(schema.postTargets.postId, post.id), eq(schema.postTargets.status, "PENDING_APPROVAL")));
  });
  const fresh = await getPost(db, actor, post.id);
  if (nextStatus === "SCHEDULED") await scheduleTargets(db, fresh.post, fresh.targets);
  await audit(db, { organizationId: post.organizationId, workspaceId: post.workspaceId, actor, action: `post.${decision}`, targetType: "post", targetId: post.id, metadata: { version: post.currentVersion } });
  if (decision === "approved") await emitEvent(db, { organizationId: post.organizationId, workspaceId: post.workspaceId, event: "post.approved", data: { post_id: post.id, version: post.currentVersion } });
  return postView(fresh.post, fresh.targets);
}

/** Publish now (or schedule at existing time). Never bypasses approval. */
export async function requestPublish(db: Db, actor: Actor, postId: string) {
  const { post } = await getPost(db, actor, postId);
  authorize(actor, post.workspaceId, "posts.publish");
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, post.workspaceId));
  if (ws!.approvalRequired && post.approvedVersion !== post.currentVersion) throw new AppError("APPROVAL_REQUIRED", "This post must be approved before publishing");
  if (!["DRAFT", "APPROVED", "FAILED_FINAL", "FAILED_RETRYABLE"].includes(post.status)) throw new AppError("INVALID_STATE_TRANSITION", `Cannot publish a post in status ${post.status}`);
  const at = new Date();
  await db.update(schema.posts).set({ status: "SCHEDULED", scheduledAt: at, updatedAt: at }).where(eq(schema.posts.id, post.id));
  await db.update(schema.postTargets).set({ status: "SCHEDULED", scheduledAt: at, updatedAt: at }).where(and(eq(schema.postTargets.postId, post.id), inArray(schema.postTargets.status, ["DRAFT", "APPROVED", "FAILED_FINAL", "FAILED_RETRYABLE"])));
  const fresh = await getPost(db, actor, post.id);
  await scheduleTargets(db, fresh.post, fresh.targets);
  await audit(db, { organizationId: post.organizationId, workspaceId: post.workspaceId, actor, action: "post.publish_requested", targetType: "post", targetId: post.id });
  return postView(fresh.post, fresh.targets);
}

export async function cancelPost(db: Db, actor: Actor, postId: string) {
  const { post } = await getPost(db, actor, postId);
  authorize(actor, post.workspaceId, "posts.write");
  assertTransition(post.status, "CANCELLED");
  await db.update(schema.posts).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(schema.posts.id, post.id));
  await db.update(schema.postTargets).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(eq(schema.postTargets.postId, post.id), inArray(schema.postTargets.status, ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "FAILED_RETRYABLE", "CHANGES_REQUESTED"])));
  await audit(db, { organizationId: post.organizationId, workspaceId: post.workspaceId, actor, action: "post.cancelled", targetType: "post", targetId: post.id });
  const fresh = await getPost(db, actor, post.id);
  return postView(fresh.post, fresh.targets);
}

export async function listPosts(db: Db, actor: Actor, p: { workspaceId: string; statuses?: PostStatus[]; from?: Date; to?: Date; limit?: number }) {
  await loadWorkspace(db, actor, p.workspaceId, "posts.read");
  const rows = await db
    .select()
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.workspaceId, p.workspaceId),
        eq(schema.posts.organizationId, actor.organizationId),
        isNull(schema.posts.deletedAt),
        p.statuses?.length ? inArray(schema.posts.status, p.statuses) : undefined,
        p.from ? gte(schema.posts.scheduledAt, p.from) : undefined,
        p.to ? lte(schema.posts.scheduledAt, p.to) : undefined,
      ),
    )
    .limit(p.limit ?? 200);
  const ids = rows.map((r) => r.id);
  const targets = ids.length ? await db.select().from(schema.postTargets).where(inArray(schema.postTargets.postId, ids)) : [];
  return rows
    .sort((a, b) => (a.scheduledAt?.getTime() ?? Infinity) - (b.scheduledAt?.getTime() ?? Infinity) || b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => postView(r, targets.filter((t) => t.postId === r.id)));
}

export const postView = (p: Post, targets: (typeof schema.postTargets.$inferSelect)[]) => ({
  id: p.id,
  workspace_id: p.workspaceId,
  type: p.type,
  status: p.status,
  caption: p.caption,
  cover_mode: p.coverMode,
  scheduled_at: p.scheduledAt?.toISOString() ?? null,
  timezone: p.scheduledTimezone,
  version: p.currentVersion,
  approved_version: p.approvedVersion,
  tags: p.tags,
  external_ref: p.externalRef,
  created_at: p.createdAt.toISOString(),
  targets: targets.map((t) => ({
    id: t.id,
    account_id: t.channelId,
    status: t.status,
    publish_mode: t.publishMode,
    external_post_id: t.externalPostId,
    permalink: t.permalink,
    error_code: t.errorCode,
    error_message: t.errorMessage,
    attempts: t.attempts,
    published_at: t.publishedAt?.toISOString() ?? null,
  })),
});

/**
 * Manual-publish companion (notification mode / mobile app): the team posted by hand and confirms it here.
 * Only targets in NOTIFICATION_SENT can be confirmed; the permalink (optional) must be http(s).
 */
export async function markTargetPublishedManually(db: Db, actor: Actor, targetId: string, p: { permalink?: string } = {}) {
  const [row] = await db
    .select({ target: schema.postTargets, post: schema.posts, channel: schema.channels })
    .from(schema.postTargets)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.postTargets.postId))
    .innerJoin(schema.channels, eq(schema.channels.id, schema.postTargets.channelId))
    .where(and(eq(schema.postTargets.id, targetId), eq(schema.postTargets.organizationId, actor.organizationId)));
  if (!row) throw new AppError("NOT_FOUND", "Target not found");
  authorize(actor, row.post.workspaceId, "posts.publish", row.post.organizationId);
  if (row.target.status !== "NOTIFICATION_SENT") throw new AppError("CONFLICT", `Target is ${row.target.status}, only NOTIFICATION_SENT can be confirmed manually`);
  let permalink: string | null = null;
  if (p.permalink?.trim()) {
    try {
      const u = new URL(p.permalink.trim());
      if (!/^https?:$/.test(u.protocol)) throw new Error("protocol");
      permalink = u.toString();
    } catch {
      throw new AppError("VALIDATION_FAILED", "invalid_permalink");
    }
  }
  const now = new Date();
  const externalPostId = `manual:${row.target.id}`;
  await db.transaction(async (tx) => {
    await tx.update(schema.postTargets).set({ status: "PUBLISHED", permalink, publishedAt: now, externalPostId, errorCode: null, errorMessage: null, updatedAt: now }).where(eq(schema.postTargets.id, row.target.id));
    await tx.insert(schema.publishedPosts).values({ organizationId: row.post.organizationId, workspaceId: row.post.workspaceId, postTargetId: row.target.id, channelId: row.channel.id, platform: row.channel.platform, externalPostId, permalink, rawResponse: { manual: true }, publishedAt: now }).onConflictDoNothing();
  });
  const { refreshPostStatus } = await import("./publisher");
  await refreshPostStatus(db, row.post.id);
  await audit(db, { organizationId: row.post.organizationId, workspaceId: row.post.workspaceId, actor, action: "post.published_manually", targetType: "post_target", targetId: row.target.id, metadata: { permalink } });
  await emitEvent(db, { organizationId: row.post.organizationId, workspaceId: row.post.workspaceId, event: "post.published", data: { post_id: row.post.id, account_id: row.channel.id, external_post_id: null, permalink, manual: true } });
}
