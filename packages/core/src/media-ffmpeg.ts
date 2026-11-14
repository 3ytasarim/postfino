import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import { getAsset, createMediaAsset, storeMediaContent, type MediaTools } from "./media";
import { audit } from "./audit";
import type { Actor } from "./rbac";
import type { StorageDriver } from "./storage";

// Option B: when an independent Reels cover cannot be set via API, the user may — with
// explicit consent — get a NEW video whose first frames show the cover image. The original asset is kept
// unchanged; this is NOT equivalent to a real cover (the frame is part of the video content).

export const BAKED_COVER_SECONDS = 0.5;

function run(bin: string, args: string[], timeoutMs = 300_000) {
  return new Promise<void>((resolve, reject) =>
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => (err ? reject(new Error(`${err.message}\n${String(stderr).slice(-800)}`)) : resolve())),
  );
}

/** Pure FFmpeg step: returns MP4 bytes (H.264/AAC, faststart) = cover still for `seconds` + original video. */
export async function prependCoverFrame(
  ffmpegPath: string,
  video: Buffer,
  cover: Buffer,
  meta: { width: number; height: number; frameRate?: number; hasAudio: boolean },
  seconds = BAKED_COVER_SECONDS,
): Promise<Buffer> {
  const w = Math.round(meta.width / 2) * 2;
  const h = Math.round(meta.height / 2) * 2;
  const fps = Math.min(60, Math.max(23, Math.round(meta.frameRate ?? 30)));
  const dir = await mkdtemp(path.join(os.tmpdir(), "st-bake-"));
  try {
    const vIn = path.join(dir, "in.mp4");
    const cIn = path.join(dir, "cover.jpg");
    const out = path.join(dir, "out.mp4");
    await writeFile(vIn, video);
    await writeFile(cIn, cover);
    const norm = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${fps},format=yuv420p`;
    const args = ["-y", "-loop", "1", "-t", String(seconds), "-i", cIn, "-i", vIn];
    let filter = `[0:v]${norm}[c];[1:v]${norm}[v];`;
    if (meta.hasAudio) {
      args.push("-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=r=48000:cl=stereo");
      filter += `[1:a]aresample=48000,aformat=channel_layouts=stereo[a1];[c][2:a][v][a1]concat=n=2:v=1:a=1[ov][oa]`;
    } else {
      filter += `[c][v]concat=n=2:v=1:a=0[ov]`;
    }
    args.push("-filter_complex", filter, "-map", "[ov]");
    if (meta.hasAudio) args.push("-map", "[oa]", "-c:a", "aac", "-b:a", "128k", "-ar", "48000");
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out);
    await run(ffmpegPath, args);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Creates a derived video asset with the cover baked in. Requires explicit consent and FFMPEG_PATH. */
export async function bakeCoverIntoVideo(
  db: Db,
  storage: StorageDriver,
  actor: Actor,
  p: { videoAssetId: string; coverAssetId: string; consent: boolean; ffmpegPath?: string; tools?: MediaTools },
) {
  if (!p.consent) throw new AppError("VALIDATION_FAILED", "explicit_consent_required: baking the cover changes the original video");
  if (!p.ffmpegPath) throw new AppError("PROVIDER_NOT_CONFIGURED", "FFMPEG_PATH is not configured on this server");
  const video = await getAsset(db, actor, p.videoAssetId, "media.write");
  const cover = await getAsset(db, actor, p.coverAssetId, "media.write");
  if (video.workspaceId !== cover.workspaceId) throw new AppError("NOT_FOUND", "Assets not in the same workspace");
  if (video.kind !== "video" || cover.kind !== "image") throw new AppError("MEDIA_INVALID", "Need one video and one image");
  if (video.status !== "ready" || cover.status !== "ready") throw new AppError("MEDIA_INVALID", "Assets must be ready");
  const pr = (video.probe ?? {}) as { audioCodec?: string; frameRate?: number };
  let out: Buffer;
  try {
    out = await prependCoverFrame(p.ffmpegPath, await storage.get(video.storageKey), await storage.get(cover.storageKey), {
      width: video.width ?? 1080,
      height: video.height ?? 1920,
      frameRate: pr.frameRate,
      hasAudio: Boolean(pr.audioCodec),
    });
  } catch (e) {
    throw new AppError("MEDIA_INVALID", `ffmpeg_failed: ${(e as Error).message.slice(0, 300)}`);
  }
  const derived = await createMediaAsset(db, actor, {
    workspaceId: video.workspaceId,
    filename: video.originalFilename.replace(/\.[^.]+$/, "") + "-cover.mp4",
    mimeType: "video/mp4",
    sizeBytes: out.length,
    purpose: "video",
  });
  const stored = await storeMediaContent(db, storage, actor, derived.id, out, p.tools);
  await db
    .update(schema.mediaAssets)
    .set({ probe: { ...(stored.probe ?? {}), derivedFrom: { videoAssetId: video.id, coverAssetId: cover.id, bakedCoverSeconds: BAKED_COVER_SECONDS, consent: true } } })
    .where(eq(schema.mediaAssets.id, stored.id));
  await audit(db, { organizationId: actor.organizationId, workspaceId: video.workspaceId, actor, action: "media.cover_baked", targetType: "media", targetId: stored.id, metadata: { from: video.id, cover: cover.id } });
  return stored;
}
