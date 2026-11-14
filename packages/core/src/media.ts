import { and, eq, inArray, isNull, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import type { MediaInfo } from "@sichttakt/social-adapters";
import { sha256 } from "./crypto";
import { probe } from "./media-probe";
import { clamavScan, ffprobe } from "./media-tools";
import { loadWorkspace } from "./tenancy";
import { audit } from "./audit";
import type { Actor } from "./rbac";
import type { StorageDriver } from "./storage";

export const MEDIA_LIMITS = {
  image: { maxBytes: 20 * 1024 * 1024, mime: ["image/jpeg", "image/png", "image/webp"] },
  video: { maxBytes: 1024 * 1024 * 1024, mime: ["video/mp4", "video/quicktime"] },
  document: { maxBytes: 100 * 1024 * 1024, mime: ["application/pdf"] },
} as const;

const kindOf = (mime: string): "image" | "video" | "document" | null =>
  mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime === "application/pdf" ? "document" : null;

export async function createMediaAsset(
  db: Db,
  actor: Actor,
  p: { workspaceId: string; filename: string; mimeType: string; sizeBytes: number; purpose: "video" | "image" | "cover" | "document" },
) {
  await loadWorkspace(db, actor, p.workspaceId, "media.write");
  const kind = kindOf(p.mimeType);
  if (!kind) throw new AppError("MEDIA_INVALID", `Unsupported MIME type ${p.mimeType}`);
  const lim = MEDIA_LIMITS[kind];
  if (!(lim.mime as readonly string[]).includes(p.mimeType)) throw new AppError("MEDIA_INVALID", `Unsupported MIME type ${p.mimeType}`);
  if (p.sizeBytes > lim.maxBytes) throw new AppError("MEDIA_INVALID", `File too large (max ${lim.maxBytes} bytes)`);
  if (p.purpose === "cover" && kind !== "image") throw new AppError("MEDIA_INVALID", "Cover must be an image");
  if (p.purpose === "video" && kind !== "video") throw new AppError("MEDIA_INVALID", "Expected a video file");
  const id = crypto.randomUUID();
  const ext = p.filename.includes(".") ? p.filename.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) : "bin";
  const [row] = await db
    .insert(schema.mediaAssets)
    .values({
      id,
      organizationId: actor.organizationId,
      workspaceId: p.workspaceId,
      kind,
      purpose: p.purpose,
      originalFilename: p.filename.slice(0, 255),
      mimeType: p.mimeType,
      sizeBytes: p.sizeBytes,
      storageKey: `${actor.organizationId}/${p.workspaceId}/${id}.${ext}`,
      uploadedByUserId: actor.kind === "user" ? actor.userId : null,
      uploadedViaApiKeyId: actor.kind === "api_key" ? actor.apiKeyId : null,
    })
    .returning();
  return row!;
}

/** Stores bytes, verifies the real file signature against the declared type, probes and validates. */
export type MediaTools = { ffprobePath?: string; clamavHost?: string; clamavPort?: number };

export async function storeMediaContent(db: Db, storage: StorageDriver, actor: Actor, assetId: string, data: Buffer, tools: MediaTools = {}) {
  const asset = await getAsset(db, actor, assetId, "media.write");
  if (asset.status !== "pending_upload") throw new AppError("CONFLICT", "Asset content already uploaded");
  const errors: string[] = [];
  if (data.length !== asset.sizeBytes) errors.push(`size_mismatch: declared ${asset.sizeBytes}, received ${data.length}`);
  const pr = probe(data);
  if (pr.kind === "unknown") errors.push(`unrecognized_file: ${pr.reason}`);
  else if (pr.mimeType !== asset.mimeType && !(pr.mimeType === "video/quicktime" && asset.mimeType === "video/mp4"))
    errors.push(`mime_mismatch: declared ${asset.mimeType}, detected ${pr.mimeType}`);
  if (pr.kind === "video" && !pr.moovBeforeMdat) errors.push("video_not_faststart: moov atom must precede mdat (needs FFmpeg normalization)");

  const scan = await clamavScan(data, tools.clamavHost, tools.clamavPort);
  if (scan.status === "infected") errors.push(`virus_found: ${scan.signature}`);
  if (scan.status === "error") errors.push(`virus_scan_failed: ${scan.error}`); // fail closed when a scanner is configured
  // ffprobe (when configured) is authoritative over the built-in parser for video metadata.
  const ff = pr.kind === "video" ? await ffprobe(data, tools.ffprobePath, asset.mimeType === "video/quicktime" ? "mov" : "mp4") : { status: "not_configured" as const };
  const video = pr.kind === "video" && ff.status === "ok" ? { ...pr, durationMs: ff.durationMs ?? pr.durationMs, width: ff.width ?? pr.width, height: ff.height ?? pr.height, videoCodec: ff.videoCodec ?? pr.videoCodec, audioCodec: ff.audioCodec ?? pr.audioCodec, frameRate: ff.frameRate ?? pr.frameRate, pixFmt: ff.pixFmt } : pr;

  const status = errors.length ? "rejected" : "ready";
  if (status === "ready") await storage.put(asset.storageKey, data, asset.mimeType);
  const [row] = await db
    .update(schema.mediaAssets)
    .set({
      status,
      sha256: sha256(data),
      width: video.kind === "image" || video.kind === "video" ? (video.width ? Math.round(video.width) : null) : null,
      height: video.kind === "image" || video.kind === "video" ? (video.height ? Math.round(video.height) : null) : null,
      durationMs: video.kind === "video" ? video.durationMs : null,
      probe: { ...video, virusScan: scan.status, ffprobe: ff.status },
      validationErrors: errors,
      updatedAt: new Date(),
    })
    .where(eq(schema.mediaAssets.id, asset.id))
    .returning();
  await audit(db, { organizationId: actor.organizationId, workspaceId: asset.workspaceId, actor, action: `media.${status}`, targetType: "media", targetId: asset.id, metadata: { errors } });
  return row!;
}

export async function getAsset(db: Db, actor: Actor, assetId: string, permission: "media.read" | "media.write" = "media.read") {
  const [asset] = await db
    .select()
    .from(schema.mediaAssets)
    .where(and(eq(schema.mediaAssets.id, assetId), eq(schema.mediaAssets.organizationId, actor.organizationId), isNull(schema.mediaAssets.deletedAt)));
  if (!asset) throw new AppError("NOT_FOUND", "Media asset not found");
  await loadWorkspace(db, actor, asset.workspaceId, permission);
  return asset;
}

/** Loads assets strictly inside one workspace; any foreign / missing id → 404 (no cross-tenant probing). */
export async function loadAssetsInWorkspace(db: Db, organizationId: string, workspaceId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(schema.mediaAssets)
    .where(and(inArray(schema.mediaAssets.id, ids), eq(schema.mediaAssets.organizationId, organizationId), eq(schema.mediaAssets.workspaceId, workspaceId), isNull(schema.mediaAssets.deletedAt)));
  if (rows.length !== new Set(ids).size) throw new AppError("NOT_FOUND", "One or more media assets not found in this workspace");
  return rows;
}

export function toMediaInfo(a: typeof schema.mediaAssets.$inferSelect, publicUrl?: string): MediaInfo {
  const pr = (a.probe ?? {}) as { videoCodec?: string; audioCodec?: string; frameRate?: number };
  return {
    assetId: a.id,
    kind: a.kind as MediaInfo["kind"],
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    width: a.width ?? undefined,
    height: a.height ?? undefined,
    durationMs: a.durationMs ?? undefined,
    videoCodec: pr.videoCodec,
    audioCodec: pr.audioCodec,
    frameRate: pr.frameRate,
    publicUrl,
  };
}

export async function listMedia(db: Db, actor: Actor, workspaceId: string) {
  await loadWorkspace(db, actor, workspaceId, "media.read");
  return db
    .select()
    .from(schema.mediaAssets)
    .where(and(eq(schema.mediaAssets.workspaceId, workspaceId), eq(schema.mediaAssets.organizationId, actor.organizationId), isNull(schema.mediaAssets.deletedAt)));
}
