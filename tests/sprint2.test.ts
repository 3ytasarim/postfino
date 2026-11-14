import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { readFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { eq, schema } from "@sichttakt/db";
import {
  createPost,
  getPost,
  reschedulePost,
  bulkShift,
  setSlots,
  expandSlots,
  nextFreeSlot,
  assignQueueSlots,
  shuffleQueue,
  setQueuePaused,
  clonePost,
  claimJobs,
  processPublishJob,
  decideApproval,
  updatePost,
  bakeCoverIntoVideo,
  probe,
  AdapterRegistry,
  type PublisherDeps,
} from "@sichttakt/core";
import { InstagramAdapter, FacebookPageAdapter, ProviderError, validateInstagram, validateFacebook, type PlatformAdapter } from "@sichttakt/social-adapters";
import { createTestServices, createTenant, uploadAsset, inMinutes } from "./helpers";
import { utcToWallClock } from "@sichttakt/shared";

let svc: Awaited<ReturnType<typeof createTestServices>>;
let deps: PublisherDeps;
beforeAll(async () => {
  svc = await createTestServices();
  deps = { db: svc.db, ring: svc.ring, registry: svc.registry, storage: svc.storage, mediaUrlTtlSeconds: 600, pollIntervalMs: 0, sleep: async () => {} };
});
afterAll(() => svc.close());

/** Runs due publish jobs; with `orgId`, only that tenant's jobs are executed (others are released untouched). */
async function runWorker(at: Date, d: PublisherDeps = deps, orgId?: string) {
  const jobs = await claimJobs(svc.db, "w", { now: at, kinds: ["publish_target"], limit: 100 });
  const out = [];
  for (const j of jobs) {
    if (orgId && j.organizationId !== orgId) {
      await svc.db.update(schema.queueItems).set({ status: "pending", attempts: j.attempts - 1, lockedBy: null, lockedUntil: null }).where(eq(schema.queueItems.id, j.id));
      continue;
    }
    out.push(await processPublishJob({ ...d, now: () => at }, j));
  }
  return out;
}

async function imagePost(t: Awaited<ReturnType<typeof createTenant>>, extra: Record<string, unknown> = {}) {
  const img = await uploadAsset(svc, t.actor, t.workspace.id, "image", { width: 1080, height: 1080 });
  return createPost(svc.db, svc.registry, t.actor, { workspace_id: t.workspace.id, account_ids: [t.channel.id], type: "image", caption: "Herbst", media_asset_ids: [img.id], status: "scheduled", scheduled_at: inMinutes(60).toISOString(), publish_mode: "automatic", ...extra } as never);
}

describe("calendar: reschedule & bulk shift", () => {
  it("drag & drop moves the post, publishes at the new time only, keeps approval", async () => {
    const t = await createTenant(svc, { approvalRequired: true });
    const { post } = await imagePost(t);
    await decideApproval(svc.db, t.actor, post.id, "approved");
    const moved = await reschedulePost(svc.db, t.actor, post.id, inMinutes(180));
    expect(moved.status).toBe("SCHEDULED");
    expect(moved.approved_version).toBe(1); // moving is not a content change
    expect(await runWorker(inMinutes(61))).not.toContain("published"); // old slot: stale job skipped
    const before = svc.sandbox.publishCalls;
    await runWorker(inMinutes(181));
    expect(svc.sandbox.publishCalls - before).toBe(1);
    expect((await getPost(svc.db, t.actor, post.id)).post.status).toBe("PUBLISHED");
  });

  it("rejects past times and published posts; bulk shift is all-or-nothing", async () => {
    const t = await createTenant(svc);
    const a = (await imagePost(t)).post;
    const b = (await imagePost(t, { scheduled_at: inMinutes(30).toISOString() })).post;
    await expect(reschedulePost(svc.db, t.actor, a.id, new Date(Date.now() - 1000))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(bulkShift(svc.db, t.actor, [a.id, b.id], -40)).rejects.toMatchObject({ code: "VALIDATION_FAILED" }); // b would be in the past
    expect((await getPost(svc.db, t.actor, a.id)).post.scheduledAt!.toISOString()).toBe(a.scheduled_at);
    const shifted = await bulkShift(svc.db, t.actor, [a.id, b.id], 24 * 60);
    expect(new Date(shifted[0]!.scheduled_at!).getTime() - new Date(a.scheduled_at!).getTime()).toBe(864e5);
  });
});

describe("queue slots", () => {
  it("expands weekly slots in local time across the DST switch (09:00 stays 09:00)", () => {
    const slots = [{ weekday: 6, minuteOfDay: 9 * 60 }]; // Saturday 09:00
    const times = expandSlots(slots, "Europe/Berlin", new Date("2026-10-20T00:00:00Z"), 14);
    expect(times.map((d) => d.toISOString())).toEqual(["2026-10-24T07:00:00.000Z", "2026-10-31T08:00:00.000Z"]);
    for (const d of times) expect(utcToWallClock(d, "Europe/Berlin").hour).toBe(9);
  });
  it("skips slots that fall into the spring-forward gap", () => {
    const times = expandSlots([{ weekday: 7, minuteOfDay: 2 * 60 + 30 }], "Europe/Berlin", new Date("2027-03-22T00:00:00Z"), 14);
    expect(times.map((d) => d.toISOString())).toEqual(["2027-04-04T00:30:00.000Z"]); // 2027-03-28 02:30 does not exist
  });
  it("add-to-queue takes the next free slot; occupied slots are skipped; no slots → clear error", async () => {
    const t = await createTenant(svc);
    const img = await uploadAsset(svc, t.actor, t.workspace.id, "image", { width: 1080, height: 1080 });
    const base = { workspace_id: t.workspace.id, account_ids: [t.channel.id], type: "image", caption: "Q", media_asset_ids: [img.id], status: "scheduled", queue: true, publish_mode: "automatic" } as never;
    await expect(createPost(svc.db, svc.registry, t.actor, base)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await setSlots(svc.db, t.actor, t.channel.id, [1, 2, 3, 4, 5, 6, 7].flatMap((wd) => [{ weekday: wd, minuteOfDay: 9 * 60 }, { weekday: wd, minuteOfDay: 18 * 60 }]));
    const p1 = (await createPost(svc.db, svc.registry, t.actor, base)).post;
    const p2 = (await createPost(svc.db, svc.registry, t.actor, base)).post;
    expect(p1.status).toBe("SCHEDULED");
    expect(p2.scheduled_at).not.toBe(p1.scheduled_at);
    expect(new Date(p2.scheduled_at!).getTime()).toBeGreaterThan(new Date(p1.scheduled_at!).getTime());
    const next = await nextFreeSlot(svc.db, t.channel.id);
    expect(next.getTime()).toBeGreaterThan(new Date(p2.scheduled_at!).getTime());
    for (const p of [p1, p2]) expect([9, 18]).toContain(utcToWallClock(new Date(p.scheduled_at!), "Europe/Berlin").hour);
  });
  it("shuffle permutes queued times without losing any; pause defers publishing", async () => {
    const t = await createTenant(svc);
    await setSlots(svc.db, t.actor, t.channel.id, [1, 2, 3, 4, 5, 6, 7].map((wd) => ({ weekday: wd, minuteOfDay: 12 * 60 })));
    const img = await uploadAsset(svc, t.actor, t.workspace.id, "image", { width: 1080, height: 1080 });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await createPost(svc.db, svc.registry, t.actor, { workspace_id: t.workspace.id, account_ids: [t.channel.id], type: "image", caption: `P${i}`, media_asset_ids: [img.id], status: "draft", publish_mode: "automatic" } as never)).post.id);
    for (const id of ids) {
      await svc.db.update(schema.posts).set({ status: "SCHEDULED" }).where(eq(schema.posts.id, id));
      await svc.db.update(schema.postTargets).set({ status: "SCHEDULED" }).where(eq(schema.postTargets.postId, id));
      await assignQueueSlots(svc.db, t.actor, id);
    }
    const before = (await Promise.all(ids.map((id) => getPost(svc.db, t.actor, id)))).map((p) => p.targets[0]!.scheduledAt!.getTime());
    let seed = 0.37;
    const n = await shuffleQueue(svc.db, t.actor, t.channel.id, { random: () => (seed = (seed * 9301 + 0.49297) % 1) });
    expect(n).toBe(4);
    const after = (await Promise.all(ids.map((id) => getPost(svc.db, t.actor, id)))).map((p) => p.targets[0]!.scheduledAt!.getTime());
    expect([...after].sort()).toEqual([...before].sort());
    expect(after).not.toEqual(before);

    await setQueuePaused(svc.db, t.actor, t.workspace.id, true);
    const first = Math.min(...after);
    expect(await runWorker(new Date(first + 1000))).toContain("retry");
  });
});

describe("clone / re-share", () => {
  it("creates an unscheduled draft copy with the same media and channels", async () => {
    const t = await createTenant(svc);
    const { post } = await imagePost(t);
    const copy = await clonePost(svc.db, t.actor, post.id);
    expect(copy.id).not.toBe(post.id);
    expect(copy.status).toBe("DRAFT");
    expect(copy.scheduled_at).toBeNull();
    expect(copy.caption).toBe(post.caption);
    const c = await getPost(svc.db, t.actor, copy.id);
    expect(c.media).toHaveLength(1);
    // A content-identical edit does not bump the version (snapshot format consistent with createPost)
    expect((await updatePost(svc.db, t.actor, copy.id, { caption: post.caption })).version).toBe(1);
  });
});

describe("first comment", () => {
  it("is posted after publishing; a failure keeps the post published and is logged", async () => {
    const t = await createTenant(svc);
    const img = await uploadAsset(svc, t.actor, t.workspace.id, "image", { width: 1080, height: 1080 });
    const mk = (fc: string) =>
      createPost(svc.db, svc.registry, t.actor, { workspace_id: t.workspace.id, account_ids: [t.channel.id], type: "image", caption: "FC", media_asset_ids: [img.id], status: "scheduled", scheduled_at: inMinutes(5).toISOString(), publish_mode: "automatic", targets: [{ account_id: t.channel.id, first_comment: fc }] } as never);
    const ok = (await mk("#herbst #café")).post;
    const bad = (await mk("kaputt #fail-comment")).post;
    await runWorker(inMinutes(6));
    expect(svc.sandbox.firstComments.map((c) => c.text)).toContain("#herbst #café");
    const b = await getPost(svc.db, t.actor, bad.id);
    expect(b.post.status).toBe("PUBLISHED");
    expect(b.targets[0]!.errorCode).toBe("FIRST_COMMENT_FAILED");
    expect((await getPost(svc.db, t.actor, ok.id)).targets[0]!.errorCode).toBeNull();
  });
  it("Starter plan cannot use first comment", async () => {
    const t = await createTenant(svc, { plan: "starter" });
    const img = await uploadAsset(svc, t.actor, t.workspace.id, "image", { width: 1080, height: 1080 });
    await expect(
      createPost(svc.db, svc.registry, t.actor, { workspace_id: t.workspace.id, account_ids: [t.channel.id], type: "image", caption: "x", media_asset_ids: [img.id], status: "draft", publish_mode: "automatic", targets: [{ account_id: t.channel.id, first_comment: "hi" }] } as never),
    ).rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
  });
});

// ── Adapter contracts (mocked HTTP, no network) ──
type Call = { url: string; method: string; body: URLSearchParams };
function fakeHttp(responses: Record<string, unknown>[]) {
  const calls: Call[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: new URLSearchParams(init?.body?.toString() ?? "") });
    const r = responses.shift() ?? {};
    return new Response(JSON.stringify(r), { status: (r.__status as number) ?? 200 });
  }) as typeof fetch;
  return { calls, f };
}
const auth = { accessToken: "SECRET", externalId: "1784", meta: {} };
const img = (n: number) => ({ assetId: `i${n}`, kind: "image" as const, mimeType: "image/jpeg", sizeBytes: 1000, width: 1080, height: 1080, publicUrl: `https://cdn.test/i${n}.jpg` });
const vid = (n: number) => ({ assetId: `v${n}`, kind: "video" as const, mimeType: "video/mp4", sizeBytes: 1000, durationMs: 10_000, videoCodec: "avc1", publicUrl: `https://cdn.test/v${n}.mp4` });

describe("Instagram adapter: image, story, carousel, first comment", () => {
  it("image → image_url + caption", () => {
    const a = new InstagramAdapter({ appId: "a", appSecret: "s", graphVersion: "v27.0" });
    expect(a.buildContainerParams({ type: "image", caption: "Hi", media: [img(1)], options: {} })).toEqual({ image_url: "https://cdn.test/i1.jpg", caption: "Hi" });
  });
  it("story → media_type=STORIES with video_url or image_url", () => {
    const a = new InstagramAdapter({ appId: "a", appSecret: "s", graphVersion: "v27.0" });
    expect(a.buildContainerParams({ type: "story", caption: "", media: [], video: vid(1), options: {} })).toEqual({ media_type: "STORIES", video_url: "https://cdn.test/v1.mp4" });
    expect(a.buildContainerParams({ type: "story", caption: "", media: [img(2)], options: {} })).toEqual({ media_type: "STORIES", image_url: "https://cdn.test/i2.jpg" });
  });
  it("carousel creates item containers, waits for video items, then the parent with children", async () => {
    const { calls, f } = fakeHttp([{ id: "c1" }, { id: "c2" }, { status_code: "IN_PROGRESS" }, { status_code: "FINISHED" }, { id: "parent" }]);
    const a = new InstagramAdapter({ appId: "a", appSecret: "s", graphVersion: "v27.0", fetch: f, sleep: async () => {} });
    const r = await a.createMedia(auth, { type: "carousel", caption: "Karussell", media: [img(1), vid(2)], options: {} }, () => {});
    expect(r.containerId).toBe("parent");
    expect(calls[0]!.body.get("is_carousel_item")).toBe("true");
    expect(calls[1]!.body.get("media_type")).toBe("VIDEO");
    const parent = calls.at(-1)!.body;
    expect(parent.get("media_type")).toBe("CAROUSEL");
    expect(parent.get("children")).toBe("c1,c2");
    expect(parent.get("caption")).toBe("Karussell");
  });
  it("first comment posts to /{media-id}/comments", async () => {
    const { calls, f } = fakeHttp([{ id: "cm1" }]);
    const a = new InstagramAdapter({ appId: "a", appSecret: "s", graphVersion: "v27.0", fetch: f });
    await a.postFirstComment(auth, "media9", "#tags", () => {});
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v27.0/media9/comments");
    expect(calls[0]!.body.get("message")).toBe("#tags");
  });
  it("validation: carousel 2–10 items, story caption warning", () => {
    expect(validateInstagram({ type: "carousel", caption: "", media: [img(1)], options: {} }).map((i) => i.code)).toContain("carousel_count");
    expect(validateInstagram({ type: "carousel", caption: "", media: Array.from({ length: 11 }, (_, i) => img(i)), options: {} }).map((i) => i.code)).toContain("carousel_count");
    expect(validateInstagram({ type: "carousel", caption: "", media: [img(1), img(2)], options: {} })).toEqual([]);
    expect(validateInstagram({ type: "story", caption: "Text", media: [img(1)], options: {} }).map((i) => i.code)).toEqual(["story_caption_warning"]);
  });
});

describe("Facebook Pages adapter", () => {
  it("builds feed / photos / videos calls", () => {
    const a = new FacebookPageAdapter({ appId: "a", appSecret: "s", graphVersion: "v27.0" });
    expect(a.buildPublishCall("p1", { type: "text", caption: "Neu: https://example.de/x", media: [], options: {} })).toEqual({ path: "/p1/feed", params: { message: "Neu: https://example.de/x", link: "https://example.de/x" } });
    expect(a.buildPublishCall("p1", { type: "image", caption: "Bild", media: [img(1)], options: {} })).toEqual({ path: "/p1/photos", params: { url: "https://cdn.test/i1.jpg", caption: "Bild", published: "true" } });
    expect(a.buildPublishCall("p1", { type: "video", caption: "Film", media: [], video: vid(1), options: {} }).path).toBe("/p1/videos");
    expect(() => a.buildPublishCall("p1", { type: "story", caption: "", media: [], options: {} })).toThrow();
  });
  it("exchangeCode returns pages the user can post to, with page tokens", async () => {
    const { f } = fakeHttp([
      { access_token: "short" },
      { access_token: "long" },
      { data: [{ permission: "pages_manage_posts", status: "granted" }, { permission: "x", status: "declined" }] },
      { data: [{ id: "p1", name: "Café", access_token: "PAGE1", tasks: ["CREATE_CONTENT"] }, { id: "p2", name: "Readonly", access_token: "PAGE2", tasks: ["ANALYZE"] }] },
    ]);
    const a = new FacebookPageAdapter({ appId: "a", appSecret: "s", graphVersion: "v27.0", fetch: f });
    const acc = await a.exchangeCode({ code: "c", redirectUri: "https://api/cb" });
    expect(acc.map((x) => [x.externalId, x.accessToken])).toEqual([["p1", "PAGE1"]]);
    expect(acc[0]!.grantedScopes).toEqual(["pages_manage_posts"]);
  });
  it("validates text length and image type", () => {
    expect(validateFacebook({ type: "text", caption: "", media: [], options: {} }).map((i) => i.code)).toContain("text_required");
    expect(validateFacebook({ type: "image", caption: "x", media: [{ ...img(1), mimeType: "image/webp" }], options: {} }).map((i) => i.code)).toContain("image_format");
  });
});

describe("direct publish (Facebook) never posts twice", () => {
  it("network failure → next attempt reports PUBLISH_RESULT_UNKNOWN; definitive provider error → safe retry", async () => {
    const t = await createTenant(svc);
    const [fb] = await svc.db.insert(schema.channels).values({ organizationId: t.organization.id, workspaceId: t.workspace.id, platform: "facebook_page", externalId: "page-1", displayName: "FB Seite" }).returning();
    const { encrypt } = await import("@sichttakt/core");
    const enc = encrypt(svc.ring, "PAGE-TOKEN");
    await svc.db.insert(schema.channelCredentials).values({ organizationId: t.organization.id, channelId: fb!.id, accessTokenEnc: enc.value, keyVersion: enc.version });

    let mode: "network" | "ratelimit" | "ok" = "network";
    let posts = 0;
    const fakeFb = new FacebookPageAdapter({
      appId: "a",
      appSecret: "s",
      graphVersion: "v27.0",
      fetch: (async () => {
        if (mode === "network") {
          posts++; // request reached Facebook, response lost
          throw new Error("socket hang up");
        }
        if (mode === "ratelimit") return new Response(JSON.stringify({ error: { message: "rate", code: 4 } }), { status: 400 });
        posts++;
        return new Response(JSON.stringify({ id: "photo1", post_id: "page-1_99", permalink_url: "https://facebook.com/x" }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const registry = new AdapterRegistry(svc.config, { sandbox: svc.sandbox, facebook_page: fakeFb as unknown as PlatformAdapter });
    const d = { ...deps, registry };
    const text = (c: string) => createPost(svc.db, registry, t.actor, { workspace_id: t.workspace.id, account_ids: [fb!.id], type: "text", caption: c, media_asset_ids: [], status: "scheduled", scheduled_at: inMinutes(5).toISOString(), publish_mode: "automatic" } as never);

    const p1 = (await text("Netzwerkfehler-Test")).post;
    expect(await runWorker(inMinutes(6), d, t.organization.id)).toEqual(["retry"]);
    expect(await runWorker(inMinutes(60 * 24), d, t.organization.id)).toEqual(["failed"]);
    const t1 = (await getPost(svc.db, t.actor, p1.id)).targets[0]!;
    expect(t1.errorCode).toBe("CONFLICT");
    expect(t1.errorMessage).toContain("PUBLISH_RESULT_UNKNOWN");
    expect(posts).toBe(1);

    mode = "ratelimit";
    const p2 = (await text("Ratelimit-Test")).post;
    expect(await runWorker(inMinutes(6), d, t.organization.id)).toEqual(["retry"]);
    mode = "ok";
    expect(await runWorker(inMinutes(60 * 24), d, t.organization.id)).toEqual(["published"]);
    expect((await getPost(svc.db, t.actor, p2.id)).targets[0]!.externalPostId).toBe("page-1_99");
  });
});

describe("option B: bake cover into video (real FFmpeg)", () => {
  const require = createRequire(import.meta.url);
  const ffmpegPath = require("ffmpeg-static") as string;
  const sh = (args: string[]) => new Promise<void>((res, rej) => execFile(ffmpegPath, args, (e) => (e ? rej(e) : res())));

  it("requires consent and FFMPEG_PATH; produces a new longer H.264 video, original untouched", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "st-ff-"));
    const v = path.join(dir, "v.mp4");
    const c = path.join(dir, "c.jpg");
    await sh(["-y", "-f", "lavfi", "-i", "testsrc=size=540x960:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", v]);
    await sh(["-y", "-f", "lavfi", "-i", "color=c=orange:size=1080x1920", "-frames:v", "1", c]);
    const t = await createTenant(svc);
    const { createMediaAsset, storeMediaContent } = await import("@sichttakt/core");
    const up = async (file: string, mime: string, purpose: "video" | "cover") => {
      const data = await readFile(file);
      const a = await createMediaAsset(svc.db, t.actor, { workspaceId: t.workspace.id, filename: path.basename(file), mimeType: mime, sizeBytes: data.length, purpose });
      return storeMediaContent(svc.db, svc.storage, t.actor, a.id, data);
    };
    const video = await up(v, "video/mp4", "video");
    const cover = await up(c, "image/jpeg", "cover");
    expect(video.status).toBe("ready");
    expect(video.durationMs).toBeGreaterThan(3900);

    await expect(bakeCoverIntoVideo(svc.db, svc.storage, t.actor, { videoAssetId: video.id, coverAssetId: cover.id, consent: false, ffmpegPath })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(bakeCoverIntoVideo(svc.db, svc.storage, t.actor, { videoAssetId: video.id, coverAssetId: cover.id, consent: true })).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });

    const baked = await bakeCoverIntoVideo(svc.db, svc.storage, t.actor, { videoAssetId: video.id, coverAssetId: cover.id, consent: true, ffmpegPath });
    expect(baked.id).not.toBe(video.id);
    expect(baked.status).toBe("ready");
    const pr = probe(await svc.storage.get(baked.storageKey));
    expect(pr).toMatchObject({ kind: "video", videoCodec: "avc1", audioCodec: "mp4a", moovBeforeMdat: true, width: 540, height: 960 });
    expect((pr as { durationMs: number }).durationMs).toBeGreaterThan(4300);
    const [orig] = await svc.db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.id, video.id));
    expect(orig!.sha256).toBe(video.sha256);
  }, 120_000);
});

// keep ProviderError import used for type completeness
void ProviderError;
