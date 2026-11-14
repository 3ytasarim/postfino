/**
 * Instagram Reels — independent cover PoC. Writes evidence to poc-output/.
 *
 * DRY RUN (default, no network to Meta):
 *   pnpm poc:reels --video ./reel_video.mp4 --cover ./cover.jpg
 *
 * URL CHECK (fetches the given HTTPS URLs like Meta would, still no Meta call):
 *   pnpm poc:reels --video ./reel_video.mp4 --cover ./cover.jpg --video-url https://… --cover-url https://…
 *
 * LIVE (creates a real Instagram Reel — only with the owner's explicit approval):
 *   META_ACCESS_TOKEN=… META_IG_USER_ID=… pnpm poc:reels … --video-url … --cover-url … --live --confirm-live-publish
 *   --scenario normal|cover   (normal = no cover_url, thumb_offset; cover = independent cover_url)
 *
 * "Scheduled" scenario is covered by the app pipeline (create post with scheduled_at → worker publishes).
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { probe } from "@sichttakt/core";
import { InstagramAdapter, validateInstagram, type MediaInfo, type ProviderCallLog } from "@sichttakt/social-adapters";

const { values: a } = parseArgs({
  options: {
    video: { type: "string" },
    cover: { type: "string" },
    "video-url": { type: "string" },
    "cover-url": { type: "string" },
    scenario: { type: "string", default: "cover" },
    caption: { type: "string", default: "SichtTakt PoC – unabhängiges Reels-Cover" },
    live: { type: "boolean", default: false },
    "confirm-live-publish": { type: "boolean", default: false },
    "graph-version": { type: "string", default: process.env.META_GRAPH_VERSION ?? "v27.0" },
  },
});

const evidence: Record<string, unknown> = { startedAt: new Date().toISOString(), scenario: a.scenario, graphVersion: a["graph-version"], steps: [] as unknown[] };
const step = (name: string, data: unknown) => {
  (evidence.steps as unknown[]).push({ at: new Date().toISOString(), name, data });
  console.log(`\n▶ ${name}\n${JSON.stringify(data, null, 2)}`);
};

async function local(file: string | undefined, kind: "video" | "image"): Promise<MediaInfo | undefined> {
  if (!file) return undefined;
  const buf = await readFile(file);
  const p = probe(buf);
  step(`probe ${kind} ${path.basename(file)}`, { bytes: buf.length, ...p });
  if (p.kind === "unknown") throw new Error(`${file}: ${p.reason}`);
  return {
    assetId: path.basename(file),
    kind: p.kind,
    mimeType: p.mimeType,
    sizeBytes: buf.length,
    width: p.width ? Math.round(p.width) : undefined,
    height: p.height ? Math.round(p.height) : undefined,
    durationMs: p.kind === "video" ? p.durationMs : undefined,
    videoCodec: p.kind === "video" ? p.videoCodec : undefined,
    audioCodec: p.kind === "video" ? p.audioCodec : undefined,
    frameRate: p.kind === "video" ? p.frameRate : undefined,
  };
}

async function checkUrl(url: string, expectMime: string) {
  // Same checks Meta's fetcher depends on: HTTPS, 200, correct Content-Type, Content-Length.
  const res = await fetch(url, { method: "GET", headers: { range: "bytes=0-1023" } });
  const info = { url: url.replace(/([?&](sig|signature|X-Amz-Signature)=)[^&]+/gi, "$1…"), status: res.status, contentType: res.headers.get("content-type"), contentLength: res.headers.get("content-length") ?? res.headers.get("content-range") };
  step("url check", info);
  if (!url.startsWith("https://")) throw new Error("Meta requires a public HTTPS URL");
  if (res.status !== 200 && res.status !== 206) throw new Error(`URL not reachable: ${res.status}`);
  if (!info.contentType?.startsWith(expectMime)) throw new Error(`Content-Type ${info.contentType} ≠ ${expectMime}`);
}

async function main() {
  const video = await local(a.video, "video");
  const cover = a.scenario === "cover" ? await local(a.cover, "image") : undefined;
  if (video && a["video-url"]) video.publicUrl = a["video-url"];
  if (cover && a["cover-url"]) cover.publicUrl = a["cover-url"];

  const input = { type: "reel" as const, caption: a.caption!, media: [], video, cover, thumbOffsetMs: a.scenario === "normal" ? 0 : undefined, options: { shareToFeed: true } };
  const issues = validateInstagram(input);
  step("pre-API validation", issues.length ? issues : "OK");
  if (issues.some((i) => !i.code.endsWith("_warning"))) throw new Error("Validation failed — fix media before any API call");

  if (cover?.width && cover.height) {
    // Preview geometry the UI renders: Reels tab 9:16, profile grid 3:4 (current app) and 1:1 (Meta docs for feed share).
    const crop = (rw: number, rh: number) => {
      const target = rw / rh;
      const r = cover.width! / cover.height!;
      return r > target ? { w: Math.round(cover.height! * target), h: cover.height } : { w: cover.width, h: Math.round(cover.width! / target) };
    };
    step("cover crop preview (center)", { reels_9x16: crop(9, 16), grid_3x4: crop(3, 4), grid_1x1: crop(1, 1) });
  }

  if (a["video-url"]) await checkUrl(a["video-url"], "video/");
  if (a["cover-url"]) await checkUrl(a["cover-url"], "image/jpeg");

  const adapter = new InstagramAdapter({ appId: process.env.META_APP_ID ?? "unset", appSecret: process.env.META_APP_SECRET ?? "unset", graphVersion: a["graph-version"]! });
  if (video?.publicUrl && (a.scenario !== "cover" || cover?.publicUrl)) {
    const params = adapter.buildContainerParams(input);
    step("container request that WOULD be sent (POST /{ig-user-id}/media)", params);
  } else {
    step("container request", "skipped — provide --video-url (and --cover-url) hosted on public HTTPS");
  }

  const token = process.env.META_ACCESS_TOKEN;
  const igUser = process.env.META_IG_USER_ID;
  if (!a.live) {
    evidence.result = token && igUser ? "DRY_RUN_OK (credentials present, live not requested)" : "BLOCKED: META_ACCESS_TOKEN / META_IG_USER_ID not provided";
    return;
  }
  if (!a["confirm-live-publish"]) throw new Error("--live requires --confirm-live-publish (owner approval for a real Instagram post)");
  if (!token || !igUser) throw new Error("BLOCKED: META_ACCESS_TOKEN and META_IG_USER_ID required for live run");

  const auth = { accessToken: token, externalId: igUser, meta: {} };
  const log = (l: ProviderCallLog) => step(`graph ${l.step}`, { request: l.request, response: l.response, ms: l.durationMs });
  const { containerId } = await adapter.createMedia(auth, input, log);
  let status = await adapter.getPublishStatus(auth, containerId, log);
  for (let i = 0; status === "in_progress" && i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    status = await adapter.getPublishStatus(auth, containerId, log);
  }
  if (status !== "ready") throw new Error(`container status ${status}`);
  const { externalPostId } = await adapter.publish(auth, containerId, log);
  const permalink = await adapter.getPostUrl(auth, externalPostId);
  const media = await fetch(
    `https://graph.facebook.com/${a["graph-version"]}/${externalPostId}?fields=id,media_type,media_product_type,permalink,thumbnail_url,timestamp&access_token=${encodeURIComponent(token)}`,
  ).then((r) => r.json());
  step("published media", { externalPostId, permalink, media });
  evidence.result = "PUBLISHED — now verify manually: (a) Reels tab cover, (b) profile grid tile, (c) video content unchanged. Keep screenshots next to the evidence file.";
}

main()
  .catch((e) => {
    evidence.result = `ERROR: ${(e as Error).message}`;
    console.error(`\n✖ ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    evidence.finishedAt = new Date().toISOString();
    await mkdir("poc-output", { recursive: true });
    const f = path.join("poc-output", `reels-poc-${Date.now()}.json`);
    await writeFile(f, JSON.stringify(evidence, null, 2));
    console.log(`\nResult: ${evidence.result}\nEvidence: ${f}`);
  });
