import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, schema } from "@sichttakt/db";
import {
  claimJobs,
  createPost,
  decideApproval,
  disconnectChannel,
  getPost,
  processPublishJob,
  updatePost,
  createMediaAsset,
  storeMediaContent,
  type PublisherDeps,
} from "@sichttakt/core";
import { createTestServices, createTenant, uploadAsset, inMinutes } from "./helpers";
import { mp4 } from "./fixtures";

let svc: Awaited<ReturnType<typeof createTestServices>>;
let deps: PublisherDeps;
const future = (min: number) => inMinutes(min).toISOString();

beforeAll(async () => {
  svc = await createTestServices();
  deps = { db: svc.db, ring: svc.ring, registry: svc.registry, storage: svc.storage, mediaUrlTtlSeconds: 600, pollIntervalMs: 0, sleep: async () => {} };
});
afterAll(() => svc.close());

/** Claims due jobs as if the clock were `at` and runs them. */
async function runWorker(at: Date, workerId = "w1") {
  const jobs = await claimJobs(svc.db, workerId, { now: at, kinds: ["publish_target"] });
  const out = [];
  for (const j of jobs) out.push(await processPublishJob({ ...deps, now: () => at }, j));
  return out;
}

async function reelPost(t: Awaited<ReturnType<typeof createTenant>>, extra: Partial<Parameters<typeof createPost>[3]> = {}) {
  const video = await uploadAsset(svc, t.actor, t.workspace.id, "video");
  const cover = await uploadAsset(svc, t.actor, t.workspace.id, "cover");
  return createPost(svc.db, svc.registry, t.actor, {
    workspace_id: t.workspace.id,
    account_ids: [t.channel.id],
    type: "reel",
    caption: "Unser neuer Cocktail ist da! #bar",
    media_asset_ids: [],
    video_asset_id: video.id,
    cover_asset_id: cover.id,
    status: "scheduled",
    scheduled_at: future(10),
    publish_mode: "automatic",
    ...extra,
  });
}

describe("publishing pipeline (sandbox adapter — no real network)", () => {
  it("publishes a scheduled reel with an independent cover exactly once even if the job runs twice", async () => {
    const t = await createTenant(svc);
    const { post } = await reelPost(t);
    expect(post.status).toBe("SCHEDULED");
    expect(post.cover_mode).toBe("independent_image");

    // Not due yet
    expect(await runWorker(inMinutes(5))).toEqual([]);

    const before = svc.sandbox.publishCalls;
    const at = inMinutes(11);
    expect(await runWorker(at)).toEqual(["published"]);

    // Simulate a duplicate delivery: re-enqueue the same target with a different dedup key and run again.
    const [target] = await svc.db.select().from(schema.postTargets).where(eq(schema.postTargets.postId, post.id));
    await svc.db.insert(schema.queueItems).values({ kind: "publish_target", payload: { postTargetId: target!.id, version: 1 }, runAt: at });
    expect(await runWorker(at, "w2")).toEqual(["skipped"]);
    expect(svc.sandbox.publishCalls - before).toBe(1);

    const fresh = await getPost(svc.db, t.actor, post.id);
    expect(fresh.post.status).toBe("PUBLISHED");
    expect(fresh.targets[0]!.permalink).toContain("sandbox");
    const published = await svc.db.select().from(schema.publishedPosts).where(eq(schema.publishedPosts.postTargetId, target!.id));
    expect(published).toHaveLength(1);
  });

  it("two workers claiming concurrently never get the same job", async () => {
    const t = await createTenant(svc);
    await reelPost(t);
    const at = inMinutes(11);
    const [a, b] = await Promise.all([claimJobs(svc.db, "wa", { now: at }), claimJobs(svc.db, "wb", { now: at })]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("retries transient provider errors with backoff, then fails final and emits post.failed", async () => {
    const t = await createTenant(svc);
    await svc.db.insert(schema.webhookSubscriptions).values({ organizationId: t.organization.id, url: "https://example.test/hook", events: ["post.failed"], secretEnc: "x", keyVersion: "dev" });
    const { post } = await reelPost(t, { caption: "kaputt #fail-retry" });
    const [job0] = await svc.db.select().from(schema.queueItems).where(eq(schema.queueItems.kind, "publish_target"));
    expect(job0).toBeDefined();
    let at = inMinutes(11);
    const outcomes: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await runWorker(at);
      outcomes.push(...r);
      at = inMinutes(24 * 60, at); // jump past any backoff
    }
    expect(outcomes.filter((o) => o === "retry").length).toBe(5);
    expect(outcomes.at(-1) === "failed" || outcomes.includes("failed")).toBe(true);
    const fresh = await getPost(svc.db, t.actor, post.id);
    expect(fresh.targets[0]!.status).toBe("FAILED_FINAL");
    expect(fresh.targets[0]!.errorCode).toBe("SANDBOX_TRANSIENT");
    const deliveries = await svc.db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.organizationId, t.organization.id));
    expect(deliveries.map((d) => d.event)).toContain("post.failed");
  });

  it("content requiring approval is never published automatically", async () => {
    const t = await createTenant(svc, { approvalRequired: true });
    const { post } = await reelPost(t);
    expect(post.status).toBe("PENDING_APPROVAL");
    expect(await runWorker(inMinutes(11))).toEqual([]); // nothing was enqueued
    const before = svc.sandbox.publishCalls;

    // Even a forged job is blocked by the worker's approval gate.
    const [target] = await svc.db.select().from(schema.postTargets).where(eq(schema.postTargets.postId, post.id));
    await svc.db.update(schema.postTargets).set({ status: "SCHEDULED" }).where(eq(schema.postTargets.id, target!.id));
    await svc.db.insert(schema.queueItems).values({ kind: "publish_target", payload: { postTargetId: target!.id, version: 1 }, runAt: new Date() });
    expect(await runWorker(inMinutes(11))).toEqual(["blocked"]);
    expect(svc.sandbox.publishCalls).toBe(before);
  });

  it("approval → scheduled; a critical edit after approval requires re-approval", async () => {
    const t = await createTenant(svc, { approvalRequired: true });
    const { post } = await reelPost(t);
    const approved = await decideApproval(svc.db, t.actor, post.id, "approved");
    expect(approved.status).toBe("SCHEDULED");
    expect(approved.approved_version).toBe(1);

    const edited = await updatePost(svc.db, t.actor, post.id, { caption: "Neue Caption nach Freigabe" });
    expect(edited.status).toBe("PENDING_APPROVAL");
    expect(edited.version).toBe(2);
    expect(edited.approved_version).toBeNull();

    // The job enqueued for version 1 is now stale and must not publish.
    const before = svc.sandbox.publishCalls;
    const outcomes = await runWorker(inMinutes(11));
    expect(outcomes.every((o) => o === "skipped" || o === "blocked")).toBe(true);
    expect(svc.sandbox.publishCalls).toBe(before);

    const again = await decideApproval(svc.db, t.actor, post.id, "approved");
    expect(again.approved_version).toBe(2);
    expect(await runWorker(inMinutes(11))).toEqual(["published"]);
  });

  it("a non-content edit (same snapshot) does not invalidate approval", async () => {
    const t = await createTenant(svc, { approvalRequired: true });
    const { post } = await reelPost(t);
    await decideApproval(svc.db, t.actor, post.id, "approved");
    const same = await updatePost(svc.db, t.actor, post.id, { caption: "Unser neuer Cocktail ist da! #bar" });
    expect(same.status).toBe("SCHEDULED");
    expect(same.version).toBe(1);
  });

  it("disconnecting a channel revokes the token and stops publishing", async () => {
    const t = await createTenant(svc);
    const { post } = await reelPost(t);
    await disconnectChannel(svc.db, svc.ring, svc.registry, t.actor, t.channel.id);
    const [cred] = await svc.db.select().from(schema.channelCredentials).where(eq(schema.channelCredentials.channelId, t.channel.id));
    expect(cred!.revokedAt).not.toBeNull();
    expect(cred!.accessTokenEnc).toBe("revoked");
    await runWorker(inMinutes(11));
    const [tg] = await svc.db.select().from(schema.postTargets).where(eq(schema.postTargets.postId, post.id));
    expect(await svc.db.select().from(schema.publishedPosts).where(eq(schema.publishedPosts.postTargetId, tg!.id))).toHaveLength(0);
    expect((await getPost(svc.db, t.actor, post.id)).targets[0]!.status).toBe("CANCELLED");
  });

  it("rejects invalid media before any provider call", async () => {
    const t = await createTenant(svc);
    const shortVideo = await uploadAsset(svc, t.actor, t.workspace.id, "video", { durationMs: 1500 });
    const before = svc.sandbox.publishCalls;
    await expect(
      createPost(svc.db, svc.registry, t.actor, { workspace_id: t.workspace.id, account_ids: [t.channel.id], type: "reel", caption: "x", media_asset_ids: [], video_asset_id: shortVideo.id, status: "draft", publish_mode: "automatic" }),
    ).rejects.toMatchObject({ code: "MEDIA_INVALID" });
    expect(svc.sandbox.publishCalls).toBe(before);
  });

  it("rejects a file whose bytes do not match the declared type", async () => {
    const t = await createTenant(svc);
    const a = await createMediaAsset(svc.db, t.actor, { workspaceId: t.workspace.id, filename: "fake.jpg", mimeType: "image/jpeg", sizeBytes: 0, purpose: "cover" }).catch((e) => e);
    expect(a).toBeDefined();
    const data = mp4({ durationMs: 5000, width: 1080, height: 1920 });
    const asset = await createMediaAsset(svc.db, t.actor, { workspaceId: t.workspace.id, filename: "fake.jpg", mimeType: "image/jpeg", sizeBytes: data.length, purpose: "cover" });
    const stored = await storeMediaContent(svc.db, svc.storage, t.actor, asset.id, data);
    expect(stored.status).toBe("rejected");
    expect(stored.validationErrors.join()).toContain("mime_mismatch");
  });

  it("past schedule times are rejected", async () => {
    const t = await createTenant(svc);
    await expect(reelPost(t, { scheduled_at: new Date(Date.now() - 3600_000).toISOString() })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("capability matrix enforcement", () => {
  it("unverified independent cover on real Instagram is refused for automatic publishing with alternatives", async () => {
    const t = await createTenant(svc);
    // Pretend an Instagram channel exists (no network involved: createPost fails before any adapter call).
    const [ig] = await svc.db
      .insert(schema.channels)
      .values({ organizationId: t.organization.id, workspaceId: t.workspace.id, platform: "instagram_business", externalId: "1784", displayName: "IG" })
      .returning();
    const video = await uploadAsset(svc, t.actor, t.workspace.id, "video");
    const cover = await uploadAsset(svc, t.actor, t.workspace.id, "cover");
    const err = await createPost(svc.db, svc.registry, t.actor, {
      workspace_id: t.workspace.id,
      account_ids: [ig!.id],
      type: "reel",
      caption: "x",
      media_asset_ids: [],
      video_asset_id: video.id,
      cover_asset_id: cover.id,
      status: "draft",
      publish_mode: "automatic",
    }).catch((e) => e);
    expect(err.code).toBe("CAPABILITY_NOT_SUPPORTED");
    expect(err.details.alternatives).toEqual(["notification", "video_frame"]);
  });

  it("text posts on Instagram are unsupported (422)", async () => {
    const t = await createTenant(svc);
    const [ig] = await svc.db.insert(schema.channels).values({ organizationId: t.organization.id, workspaceId: t.workspace.id, platform: "instagram_business", externalId: "1785", displayName: "IG" }).returning();
    await expect(
      createPost(svc.db, svc.registry, t.actor, { workspace_id: t.workspace.id, account_ids: [ig!.id], type: "text", caption: "x", media_asset_ids: [], status: "draft", publish_mode: "automatic" }),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_SUPPORTED", status: 422 });
  });
});
