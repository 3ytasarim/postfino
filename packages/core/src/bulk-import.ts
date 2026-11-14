import path from "node:path";
import { and, eq, isNull, schema, type Db } from "@sichttakt/db";
import { AppError, NonexistentLocalTimeError, POST_TYPES, wallClockToUtc, type PostType } from "@sichttakt/shared";
import { sha256 } from "./crypto";
import { parseCsv, toCsv } from "./csv";
import { readZip, ZipError } from "./zip";
import { sniffMime } from "./media-probe";
import { loadWorkspace } from "./tenancy";
import { createMediaAsset, storeMediaContent, type MediaTools } from "./media";
import { createPost } from "./posts";
import { audit } from "./audit";
import type { AdapterRegistry } from "./channels";
import type { StorageDriver } from "./storage";
import type { Actor } from "./rbac";

// Bulk import: CSV, optionally with a ZIP of media (videos, Reels, carousels — beyond
// the reference product's image-URL-only import). Two steps:
//   1. preview → every row validated, row-level errors returned, files parked in private storage
//   2. commit  → creates posts; each row is idempotent (external_ref = import:<id>:<row>), a re-run continues
// The same CSV+ZIP+target in a workspace resolves to the same import (no duplicate posts on re-upload).

export const IMPORT_MAX_ROWS = 500;
export type ImportTarget = "draft" | "queue" | "scheduled";
export type ImportRow = {
  row: number; // 1-based data row (header excluded)
  status: "ok" | "error" | "created";
  errors: string[];
  data: { text: string; channels: string[]; channelRefs?: string[]; type: PostType; time?: string; scheduledAt?: string; media: string[]; cover?: string; firstComment?: string; tags: string[] };
  postId?: string;
};

const ALIASES: Record<string, string[]> = {
  text: ["text", "caption", "beschriftung", "metin"],
  channels: ["channels", "accounts", "kanäle", "kanale", "kanallar"],
  type: ["type", "format", "typ", "tür"],
  time: ["time", "posting time", "scheduled_at", "zeitpunkt", "zeit", "zaman"],
  media: ["media", "medien", "files", "dateien", "medya", "image url"],
  cover: ["cover", "kapak"],
  first_comment: ["first_comment", "first comment", "erster kommentar", "ilk yorum"],
  tags: ["tags", "schlagwörter", "etiketler"],
};

const split = (v: string | undefined) => (v ?? "").split(/[|\n]/).map((s) => s.trim()).filter(Boolean);
const MEDIA_EXT = /\.(jpe?g|png|webp|mp4|mov|pdf)$/i;

function zipLookup(zip: Map<string, Buffer>) {
  const byBase = new Map<string, string>();
  for (const name of zip.keys()) byBase.set(path.posix.basename(name).toLowerCase(), name);
  return (ref: string) => (zip.has(ref) ? ref : byBase.get(path.posix.basename(ref).toLowerCase()));
}

export async function previewImport(
  db: Db,
  storage: StorageDriver,
  actor: Actor,
  p: { workspaceId: string; filename: string; csv: Buffer; zip?: Buffer; target: ImportTarget; now?: Date },
) {
  const ws = await loadWorkspace(db, actor, p.workspaceId, "posts.write");
  const fileSha = sha256(Buffer.concat([p.csv, Buffer.from("\0"), p.zip ?? Buffer.alloc(0)]));
  const [existing] = await db
    .select()
    .from(schema.bulkImports)
    .where(and(eq(schema.bulkImports.workspaceId, ws.id), eq(schema.bulkImports.fileSha256, fileSha), eq(schema.bulkImports.target, p.target)));
  if (existing) return { import: existing, reused: true };

  let zip = new Map<string, Buffer>();
  if (p.zip) {
    try {
      zip = readZip(p.zip);
    } catch (e) {
      throw new AppError("MEDIA_INVALID", `ZIP rejected: ${(e as ZipError).message}`);
    }
  }
  const find = zipLookup(zip);
  const table = parseCsv(p.csv.toString("utf8"));
  if (table.length < 2) throw new AppError("VALIDATION_FAILED", "CSV needs a header row and at least one data row");
  if (table.length - 1 > IMPORT_MAX_ROWS) throw new AppError("VALIDATION_FAILED", `Max ${IMPORT_MAX_ROWS} rows per import (got ${table.length - 1})`);
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const col = (key: string) => header.findIndex((h) => ALIASES[key]!.includes(h));
  const idx = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, col(k)])) as Record<string, number>;
  if (idx.text! < 0 && idx.media! < 0) throw new AppError("VALIDATION_FAILED", `Missing columns: need "text" and/or "media". Found: ${header.join(", ")}`);
  if (idx.channels! < 0) throw new AppError("VALIDATION_FAILED", 'Missing column "channels"');

  const channels = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.workspaceId, ws.id), eq(schema.channels.organizationId, actor.organizationId), isNull(schema.channels.disconnectedAt)));
  const resolveChannel = (ref: string) =>
    channels.find((c) => c.id === ref || c.displayName.toLowerCase() === ref.toLowerCase() || (c.username && `@${c.username}`.toLowerCase() === ref.toLowerCase()) || c.username?.toLowerCase() === ref.toLowerCase());
  const now = p.now ?? new Date();

  const rows: ImportRow[] = table.slice(1).map((cells, i) => {
    const get = (k: string) => (idx[k]! >= 0 ? (cells[idx[k]!] ?? "").trim() : "");
    const errors: string[] = [];
    const media = split(get("media"));
    const typeRaw = get("type").toLowerCase();
    const isVideo = (m: string) => /\.(mp4|mov)$/i.test(m);
    let type: PostType =
      (POST_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as PostType) : media.length > 1 ? "carousel" : media.length === 1 ? (isVideo(media[0]!) ? "video" : "image") : "text";
    if (typeRaw && !(POST_TYPES as readonly string[]).includes(typeRaw)) errors.push(`Unbekanntes Format "${typeRaw}"`);
    const text = get("text");
    if (text.length > 5000) errors.push("Text länger als 5000 Zeichen");
    const chanRefs = split(get("channels").replace(/,/g, "|"));
    if (!chanRefs.length) errors.push("Kein Kanal angegeben");
    const resolved = chanRefs.map((r) => ({ r, c: resolveChannel(r) }));
    for (const x of resolved) if (!x.c) errors.push(`Kanal "${x.r}" nicht gefunden`);
    else if (x.c.status !== "active") errors.push(`Kanal "${x.r}" ist nicht aktiv`);
    for (const m of [...media, ...(get("cover") ? [get("cover")] : [])]) {
      if (/^https?:\/\//i.test(m)) errors.push(`Medien-URLs werden nicht importiert (${m}) – Datei in die ZIP legen`);
      else if (!MEDIA_EXT.test(m)) errors.push(`Nicht unterstützter Dateityp: ${m}`);
      else if (!p.zip) errors.push(`Datei ${m} referenziert, aber keine ZIP hochgeladen`);
      else {
        const f = find(m);
        if (!f) errors.push(`Datei ${m} nicht in der ZIP gefunden`);
        else if (!sniffMime(zip.get(f)!)) errors.push(`Datei ${m} hat kein erkennbares Format`);
      }
    }
    if (type === "reel" && !media.some(isVideo)) errors.push("Reel braucht eine Videodatei");
    if (get("cover") && type !== "reel") errors.push("Cover nur für Reels");
    if (type === "text" && !text) errors.push("Text fehlt");
    const time = get("time");
    let scheduledAt: string | undefined;
    if (time) {
      const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(time);
      if (!m) errors.push(`Zeit "${time}" muss YYYY-MM-DD HH:mm sein`);
      else {
        try {
          const at = wallClockToUtc({ year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +m[4]!, minute: +m[5]! }, ws.timezone);
          if (at.getTime() < now.getTime() + 60_000) errors.push(`Zeit ${time} liegt in der Vergangenheit`);
          scheduledAt = at.toISOString();
        } catch (e) {
          errors.push(e instanceof NonexistentLocalTimeError ? `Zeit ${time} existiert wegen der Zeitumstellung nicht` : `Ungültige Zeit ${time}`);
        }
      }
    } else if (p.target === "scheduled") errors.push("Zeit fehlt (Ziel: geplant)");
    return {
      row: i + 1,
      status: errors.length ? "error" : "ok",
      errors,
      data: { text, channels: resolved.filter((x) => x.c).map((x) => x.c!.id), channelRefs: chanRefs, type, time: time || undefined, scheduledAt, media, cover: get("cover") || undefined, firstComment: get("first_comment") || undefined, tags: split(get("tags").replace(/,/g, "|")) },
    } satisfies ImportRow;
  });

  const [imp] = await db
    .insert(schema.bulkImports)
    .values({
      organizationId: actor.organizationId,
      workspaceId: ws.id,
      filename: p.filename.slice(0, 200),
      fileSha256: fileSha,
      target: p.target,
      rows,
      summary: { total: rows.length, ok: rows.filter((r) => r.status === "ok").length, error: rows.filter((r) => r.status === "error").length, created: 0 },
      createdByUserId: actor.kind === "user" ? actor.userId : null,
    })
    .returning();
  // Park the uploaded files privately for the commit step.
  await storage.put(`imports/${actor.organizationId}/${imp!.id}.csv`, p.csv, "text/csv");
  if (p.zip) await storage.put(`imports/${actor.organizationId}/${imp!.id}.zip`, p.zip, "application/zip");
  await audit(db, { organizationId: actor.organizationId, workspaceId: ws.id, actor, action: "import.previewed", targetType: "bulk_import", targetId: imp!.id, metadata: imp!.summary });
  return { import: imp!, reused: false };
}

export async function getImport(db: Db, actor: Actor, importId: string) {
  const [imp] = await db.select().from(schema.bulkImports).where(and(eq(schema.bulkImports.id, importId), eq(schema.bulkImports.organizationId, actor.organizationId)));
  if (!imp) throw new AppError("NOT_FOUND", "Import not found");
  await loadWorkspace(db, actor, imp.workspaceId, "posts.read");
  return imp;
}

/** Creates posts for all valid rows that have not been created yet (safe to re-run). */
export async function commitImport(db: Db, storage: StorageDriver, registry: AdapterRegistry, actor: Actor, importId: string, tools: MediaTools = {}) {
  const imp = await getImport(db, actor, importId);
  await loadWorkspace(db, actor, imp.workspaceId, "posts.write");
  const rows = imp.rows as unknown as ImportRow[];
  let zip = new Map<string, Buffer>();
  if (rows.some((r) => r.data.media.length || r.data.cover)) {
    try {
      zip = readZip(await storage.get(`imports/${imp.organizationId}/${imp.id}.zip`));
    } catch {
      zip = new Map();
    }
  }
  const find = zipLookup(zip);
  const uploaded = new Map<string, string>(); // zip path → asset id (each file uploaded once per import)
  const asset = async (ref: string, purpose: "video" | "image" | "cover") => {
    const f = find(ref)!;
    if (uploaded.has(f)) return uploaded.get(f)!;
    const data = zip.get(f)!;
    const mime = sniffMime(data) ?? "application/octet-stream";
    const a = await createMediaAsset(db, actor, { workspaceId: imp.workspaceId, filename: path.posix.basename(f), mimeType: mime, sizeBytes: data.length, purpose: purpose === "cover" ? "cover" : mime.startsWith("video/") ? "video" : "image" });
    const stored = await storeMediaContent(db, storage, actor, a.id, data, tools);
    if (stored.status !== "ready") throw new AppError("MEDIA_INVALID", `${f}: ${stored.validationErrors.join("; ")}`);
    uploaded.set(f, stored.id);
    return stored.id;
  };

  for (const r of rows) {
    if (r.status !== "ok" || r.postId) continue;
    const ref = `import:${imp.id}:${r.row}`;
    const [already] = await db.select({ id: schema.posts.id }).from(schema.posts).where(and(eq(schema.posts.workspaceId, imp.workspaceId), eq(schema.posts.externalRef, ref)));
    if (already) {
      r.status = "created";
      r.postId = already.id;
      continue;
    }
    try {
      const isVideoType = r.data.type === "reel" || r.data.type === "video";
      const mediaIds: string[] = [];
      for (const m of r.data.media) mediaIds.push(await asset(m, isVideoType ? "video" : "image"));
      const coverId = r.data.cover ? await asset(r.data.cover, "cover") : undefined;
      const scheduled = imp.target !== "draft";
      const res = await createPost(db, registry, actor, {
        workspace_id: imp.workspaceId,
        account_ids: r.data.channels,
        type: r.data.type,
        caption: r.data.text,
        media_asset_ids: isVideoType ? [] : mediaIds,
        video_asset_id: isVideoType ? mediaIds[0] : undefined,
        cover_asset_id: coverId,
        scheduled_at: scheduled && r.data.scheduledAt ? r.data.scheduledAt : undefined,
        queue: scheduled && !r.data.scheduledAt ? true : undefined,
        status: scheduled ? "scheduled" : "draft",
        publish_mode: "automatic",
        targets: r.data.firstComment ? r.data.channels.map((c) => ({ account_id: c, first_comment: r.data.firstComment })) : undefined,
        tags: r.data.tags,
        external_ref: ref,
      });
      r.status = "created";
      r.postId = res.post.id;
      r.errors = [];
    } catch (e) {
      r.status = "error";
      r.errors = [(e as Error).message];
    }
  }
  const summary = { total: rows.length, ok: rows.filter((r) => r.status === "ok").length, error: rows.filter((r) => r.status === "error").length, created: rows.filter((r) => r.status === "created").length };
  const [updated] = await db
    .update(schema.bulkImports)
    .set({ rows: rows as unknown as Record<string, unknown>[], summary, status: summary.error ? "failed" : "committed", committedAt: new Date() })
    .where(eq(schema.bulkImports.id, imp.id))
    .returning();
  await audit(db, { organizationId: imp.organizationId, workspaceId: imp.workspaceId, actor, action: "import.committed", targetType: "bulk_import", targetId: imp.id, metadata: summary });
  return updated!;
}

/** Error rows as CSV (original values + error message) for fixing and re-uploading. */
export function importErrorsCsv(imp: { rows: unknown }) {
  const rows = (imp.rows as ImportRow[]).filter((r) => r.status === "error");
  return toCsv([
    ["row", "text", "channels", "type", "time", "media", "cover", "first_comment", "tags", "error"],
    ...rows.map((r) => [r.row, r.data.text, (r.data.channelRefs ?? r.data.channels).join("|"), r.data.type, r.data.time, r.data.media.join("|"), r.data.cover, r.data.firstComment, r.data.tags.join("|"), r.errors.join(" / ")]),
  ]);
}

export const IMPORT_TEMPLATE_CSV = toCsv([
  ["text", "channels", "type", "time", "media", "cover", "first_comment", "tags"],
  ["Unser Herbstmenü ist da! 🍂", "Café Morgenrot Instagram", "image", "2026-12-01 09:00", "herbst.jpg", "", "#herbst #café", "menü"],
  ["Behind the scenes", "Café Morgenrot Instagram", "reel", "", "reel.mp4", "cover.jpg", "", "reels"],
]);
