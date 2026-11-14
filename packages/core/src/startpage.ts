import { z } from "zod";
import { and, asc, eq, gte, sql, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import { loadWorkspace, authorize } from "./tenancy";
import { loadAssetsInWorkspace } from "./media";
import { audit } from "./audit";
import type { Actor } from "./rbac";

// Start Page (link-in-bio) + Shop Grid. Draft blocks are edited freely; "publish" freezes an
// immutable snapshot that the public page renders. "Revert" restores the draft from the last published snapshot.
// Statistics are first-party (own page only), privacy-friendly, and never mixed with platform metrics.

export const BLOCK_TYPES = ["button", "text", "image", "video", "social_links", "image_grid", "shop_grid"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
const httpUrl = z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u), "http(s) only");
const SOCIAL = ["instagram", "facebook", "linkedin", "tiktok", "youtube", "x", "threads", "pinterest", "bluesky", "mastodon", "website", "email"] as const;

export const BLOCK_SCHEMAS: Record<BlockType, z.ZodTypeAny> = {
  button: z.object({ label: z.string().min(1).max(80), url: httpUrl }),
  text: z.object({ text: z.string().min(1).max(1000), align: z.enum(["left", "center"]).default("center") }),
  image: z.object({ assetId: z.string().uuid(), alt: z.string().max(200).default(""), url: httpUrl.optional() }),
  video: z.object({ assetId: z.string().uuid(), caption: z.string().max(200).optional() }),
  social_links: z.object({ links: z.array(z.object({ network: z.enum(SOCIAL), url: z.string().max(500) })).min(1).max(12) }),
  image_grid: z.object({ items: z.array(z.object({ assetId: z.string().uuid(), url: httpUrl.optional(), alt: z.string().max(200).default("") })).min(1).max(12) }),
  shop_grid: z.object({ title: z.string().max(80).optional() }),
};

export const THEMES = { takt: { bg: "#0c0d10", fg: "#f2f1ed", accent: "#4f8dff" }, paper: { bg: "#f6f5f1", fg: "#111318", accent: "#0047ab" }, mint: { bg: "#ecf7f1", fg: "#0f2a1d", accent: "#0f8a47" }, night: { bg: "#111827", fg: "#f3f4f6", accent: "#9d93ff" } } as const;
const themeSchema = z.object({ preset: z.enum(["takt", "paper", "mint", "night"]).default("paper"), font: z.enum(["grotesk", "serif", "sans"]).default("grotesk"), buttonStyle: z.enum(["filled", "outline"]).default("filled"), avatarAssetId: z.string().uuid().nullable().optional() });
export type StartPageTheme = z.infer<typeof themeSchema>;

const RESERVED = new Set(["admin", "api", "app", "login", "p", "l", "go", "status", "developers", "review", "help", "support", "sichttakt", "bleibsichtbar"]);

async function assertAssets(db: Db, actor: Actor, workspaceId: string, data: Record<string, unknown>) {
  const ids = [data.assetId, ...((data.items as { assetId: string }[] | undefined)?.map((i) => i.assetId) ?? [])].filter((x): x is string => typeof x === "string");
  if (ids.length) {
    const rows = await loadAssetsInWorkspace(db, actor.organizationId, workspaceId, [...new Set(ids)]);
    if (rows.some((r) => r.status !== "ready")) throw new AppError("MEDIA_INVALID", "Media must be ready");
  }
}

export async function getOrCreateStartPage(db: Db, actor: Actor, workspaceId: string) {
  const ws = await loadWorkspace(db, actor, workspaceId, "posts.read");
  const [p] = await db.select().from(schema.startPages).where(eq(schema.startPages.workspaceId, ws.id));
  if (p) return p;
  authorize(actor, ws.id, "workspace.manage");
  const base = ws.slug.replace(/-[a-z0-9]{4}$/, "").slice(0, 30) || "seite";
  let slug = base;
  for (let i = 0; i < 5; i++) {
    const [taken] = await db.select({ id: schema.startPages.id }).from(schema.startPages).where(eq(schema.startPages.slug, slug));
    if (!taken && !RESERVED.has(slug)) break;
    slug = `${base}-${crypto.randomUUID().slice(0, 4)}`;
  }
  const [created] = await db.insert(schema.startPages).values({ organizationId: actor.organizationId, workspaceId: ws.id, slug, title: ws.name, theme: { preset: "paper", font: "grotesk", buttonStyle: "filled" } }).returning();
  return created!;
}

async function loadPage(db: Db, actor: Actor, pageId: string) {
  const [p] = await db.select().from(schema.startPages).where(and(eq(schema.startPages.id, pageId), eq(schema.startPages.organizationId, actor.organizationId)));
  if (!p) throw new AppError("NOT_FOUND", "Start page not found");
  authorize(actor, p.workspaceId, "workspace.manage");
  return p;
}

export async function updateStartPage(db: Db, actor: Actor, pageId: string, p: { slug?: string; title?: string; description?: string; theme?: Partial<StartPageTheme> }) {
  const page = await loadPage(db, actor, pageId);
  const slug = p.slug?.trim().toLowerCase();
  if (slug !== undefined && slug !== page.slug) {
    if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug) || RESERVED.has(slug)) throw new AppError("VALIDATION_FAILED", "invalid_slug");
    const [taken] = await db.select({ id: schema.startPages.id }).from(schema.startPages).where(eq(schema.startPages.slug, slug));
    if (taken) throw new AppError("CONFLICT", "slug_taken");
  }
  const theme = themeSchema.parse({ ...(page.theme as object), ...(p.theme ?? {}) });
  if (theme.avatarAssetId) await assertAssets(db, actor, page.workspaceId, { assetId: theme.avatarAssetId });
  const [row] = await db
    .update(schema.startPages)
    .set({ slug: slug ?? page.slug, title: p.title?.trim().slice(0, 80) || page.title, description: p.description !== undefined ? p.description.trim().slice(0, 300) || null : page.description, theme, draftVersion: page.draftVersion + 1, updatedAt: new Date() })
    .where(eq(schema.startPages.id, page.id))
    .returning();
  return row!;
}

export async function listBlocks(db: Db, pageId: string) {
  return db.select().from(schema.startPageBlocks).where(eq(schema.startPageBlocks.startPageId, pageId)).orderBy(asc(schema.startPageBlocks.position));
}

export async function addBlock(db: Db, actor: Actor, pageId: string, type: BlockType, data: unknown) {
  const page = await loadPage(db, actor, pageId);
  if (!BLOCK_TYPES.includes(type)) throw new AppError("VALIDATION_FAILED", "unknown_block_type");
  const parsed = BLOCK_SCHEMAS[type].safeParse(data);
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", "invalid_block", parsed.error.issues);
  const blockData = parsed.data as Record<string, unknown>;
  await assertAssets(db, actor, page.workspaceId, blockData);
  const existing = await listBlocks(db, page.id);
  if (existing.length >= 50) throw new AppError("QUOTA_EXCEEDED", "Max 50 blocks");
  if (type === "shop_grid" && existing.some((b) => b.type === "shop_grid")) throw new AppError("CONFLICT", "Only one shop grid per page");
  const [b] = await db.insert(schema.startPageBlocks).values({ organizationId: page.organizationId, startPageId: page.id, type, position: existing.length, data: blockData }).returning();
  await db.update(schema.startPages).set({ draftVersion: page.draftVersion + 1, updatedAt: new Date() }).where(eq(schema.startPages.id, page.id));
  return b!;
}

export async function updateBlock(db: Db, actor: Actor, blockId: string, data: unknown) {
  const [b] = await db.select().from(schema.startPageBlocks).where(and(eq(schema.startPageBlocks.id, blockId), eq(schema.startPageBlocks.organizationId, actor.organizationId)));
  if (!b) throw new AppError("NOT_FOUND", "Block not found");
  const page = await loadPage(db, actor, b.startPageId);
  const parsed = BLOCK_SCHEMAS[b.type as BlockType].safeParse(data);
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", "invalid_block", parsed.error.issues);
  const blockData = parsed.data as Record<string, unknown>;
  await assertAssets(db, actor, page.workspaceId, blockData);
  await db.update(schema.startPageBlocks).set({ data: blockData }).where(eq(schema.startPageBlocks.id, b.id));
  await db.update(schema.startPages).set({ draftVersion: page.draftVersion + 1, updatedAt: new Date() }).where(eq(schema.startPages.id, page.id));
}

export async function deleteBlock(db: Db, actor: Actor, blockId: string) {
  const [b] = await db.select().from(schema.startPageBlocks).where(and(eq(schema.startPageBlocks.id, blockId), eq(schema.startPageBlocks.organizationId, actor.organizationId)));
  if (!b) throw new AppError("NOT_FOUND", "Block not found");
  await loadPage(db, actor, b.startPageId);
  await db.delete(schema.startPageBlocks).where(eq(schema.startPageBlocks.id, b.id));
  await renumber(db, b.startPageId);
}

export async function moveBlock(db: Db, actor: Actor, blockId: string, index: number) {
  const [b] = await db.select().from(schema.startPageBlocks).where(and(eq(schema.startPageBlocks.id, blockId), eq(schema.startPageBlocks.organizationId, actor.organizationId)));
  if (!b) throw new AppError("NOT_FOUND", "Block not found");
  await loadPage(db, actor, b.startPageId);
  const ids = (await listBlocks(db, b.startPageId)).map((x) => x.id).filter((x) => x !== b.id);
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, b.id);
  for (const [i, id] of ids.entries()) await db.update(schema.startPageBlocks).set({ position: i }).where(eq(schema.startPageBlocks.id, id));
}

async function renumber(db: Db, pageId: string) {
  const blocks = await listBlocks(db, pageId);
  for (const [i, x] of blocks.entries()) if (x.position !== i) await db.update(schema.startPageBlocks).set({ position: i }).where(eq(schema.startPageBlocks.id, x.id));
}

// ── Shop Grid ──
export async function listGridItems(db: Db, pageId: string) {
  return db.select().from(schema.shopGridItems).where(eq(schema.shopGridItems.startPageId, pageId)).orderBy(asc(schema.shopGridItems.position));
}

/** Adds a grid tile from a published post (its first image / cover) or from a media asset. */
export async function addGridItem(db: Db, actor: Actor, pageId: string, p: { publishedPostId?: string; imageAssetId?: string; targetUrl: string }) {
  const page = await loadPage(db, actor, pageId);
  if (!httpUrl.safeParse(p.targetUrl).success) throw new AppError("VALIDATION_FAILED", "invalid_target_url");
  let imageAssetId = p.imageAssetId;
  if (p.publishedPostId) {
    const [row] = await db
      .select({ pp: schema.publishedPosts, postId: schema.postTargets.postId })
      .from(schema.publishedPosts)
      .innerJoin(schema.postTargets, eq(schema.postTargets.id, schema.publishedPosts.postTargetId))
      .where(and(eq(schema.publishedPosts.id, p.publishedPostId), eq(schema.publishedPosts.workspaceId, page.workspaceId)));
    if (!row) throw new AppError("NOT_FOUND", "Published post not found");
    const media = await db.select({ assetId: schema.postMedia.assetId, role: schema.postMedia.role, kind: schema.mediaAssets.kind }).from(schema.postMedia).innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, schema.postMedia.assetId)).where(eq(schema.postMedia.postId, row.postId));
    imageAssetId ??= (media.find((m) => m.role === "cover") ?? media.find((m) => m.kind === "image"))?.assetId;
  }
  if (!imageAssetId) throw new AppError("MEDIA_INVALID", "Grid tile needs an image (post without image or no asset given)");
  await assertAssets(db, actor, page.workspaceId, { assetId: imageAssetId });
  const existing = await listGridItems(db, page.id);
  if (existing.length >= 60) throw new AppError("QUOTA_EXCEEDED", "Max 60 grid tiles");
  const [it] = await db.insert(schema.shopGridItems).values({ organizationId: page.organizationId, startPageId: page.id, publishedPostId: p.publishedPostId ?? null, imageAssetId, targetUrl: p.targetUrl, position: existing.length }).returning();
  return it!;
}

export async function deleteGridItem(db: Db, actor: Actor, itemId: string) {
  const [it] = await db.select().from(schema.shopGridItems).where(and(eq(schema.shopGridItems.id, itemId), eq(schema.shopGridItems.organizationId, actor.organizationId)));
  if (!it) throw new AppError("NOT_FOUND", "Grid tile not found");
  await loadPage(db, actor, it.startPageId);
  await db.delete(schema.shopGridItems).where(eq(schema.shopGridItems.id, it.id));
}

// ── Publish / revert ──
export type StartPageSnapshot = { version: number; title: string; description: string | null; theme: StartPageTheme; blocks: { id: string; type: BlockType; data: Record<string, unknown> }[]; grid: { id: string; imageAssetId: string; targetUrl: string }[] };

export async function publishStartPage(db: Db, actor: Actor, pageId: string) {
  const page = await loadPage(db, actor, pageId);
  const blocks = await listBlocks(db, page.id);
  const grid = await listGridItems(db, page.id);
  const version = (page.publishedVersion ?? 0) + 1;
  const snapshot: StartPageSnapshot = {
    version,
    title: page.title,
    description: page.description,
    theme: themeSchema.parse(page.theme),
    blocks: blocks.map((b) => ({ id: b.id, type: b.type as BlockType, data: b.data })),
    grid: grid.map((g) => ({ id: g.id, imageAssetId: g.imageAssetId!, targetUrl: g.targetUrl })),
  };
  await db.update(schema.startPages).set({ publishedSnapshot: snapshot, publishedVersion: version, publishedAt: new Date(), updatedAt: new Date() }).where(eq(schema.startPages.id, page.id));
  await audit(db, { organizationId: page.organizationId, workspaceId: page.workspaceId, actor, action: "start_page.published", targetType: "start_page", targetId: page.id, metadata: { version, slug: page.slug } });
  return snapshot;
}

/** Undo draft changes: restore blocks + grid + theme from the published snapshot. */
export async function revertStartPageDraft(db: Db, actor: Actor, pageId: string) {
  const page = await loadPage(db, actor, pageId);
  const snap = page.publishedSnapshot as StartPageSnapshot | null;
  if (!snap) throw new AppError("CONFLICT", "Nothing published yet");
  await db.transaction(async (tx) => {
    await tx.delete(schema.startPageBlocks).where(eq(schema.startPageBlocks.startPageId, page.id));
    await tx.delete(schema.shopGridItems).where(eq(schema.shopGridItems.startPageId, page.id));
    if (snap.blocks.length) await tx.insert(schema.startPageBlocks).values(snap.blocks.map((b, i) => ({ id: b.id, organizationId: page.organizationId, startPageId: page.id, type: b.type, position: i, data: b.data })));
    if (snap.grid.length) await tx.insert(schema.shopGridItems).values(snap.grid.map((g, i) => ({ id: g.id, organizationId: page.organizationId, startPageId: page.id, imageAssetId: g.imageAssetId, targetUrl: g.targetUrl, position: i })));
    await tx.update(schema.startPages).set({ title: snap.title, description: snap.description, theme: snap.theme, draftVersion: page.draftVersion + 1, updatedAt: new Date() }).where(eq(schema.startPages.id, page.id));
  });
}

export async function unpublishStartPage(db: Db, actor: Actor, pageId: string) {
  const page = await loadPage(db, actor, pageId);
  await db.update(schema.startPages).set({ publishedSnapshot: null, publishedAt: null }).where(eq(schema.startPages.id, page.id));
  await audit(db, { organizationId: page.organizationId, workspaceId: page.workspaceId, actor, action: "start_page.unpublished", targetType: "start_page", targetId: page.id });
}

// ── Public access (no actor) ──
export async function getPublishedPage(db: Db, slug: string) {
  const [p] = await db.select().from(schema.startPages).where(eq(schema.startPages.slug, slug.toLowerCase()));
  if (!p || !p.publishedSnapshot) return null;
  return { page: p, snapshot: p.publishedSnapshot as unknown as StartPageSnapshot };
}

/** Is this asset part of the published snapshot? (public media route guard) */
export function snapshotHasAsset(snap: StartPageSnapshot, assetId: string) {
  if (snap.theme.avatarAssetId === assetId) return true;
  if (snap.grid.some((g) => g.imageAssetId === assetId)) return true;
  return snap.blocks.some((b) => b.data.assetId === assetId || (b.data.items as { assetId: string }[] | undefined)?.some((i) => i.assetId === assetId));
}

export function deviceClass(userAgent: string | null): "mobile" | "desktop" | "bot" {
  const ua = userAgent ?? "";
  if (!ua || /bot|crawl|spider|preview|facebookexternalhit|slurp|headless/i.test(ua)) return "bot";
  return /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop";
}

const refHost = (ref: string | null) => {
  try {
    return ref ? new URL(ref).hostname.slice(0, 100) : null;
  } catch {
    return null;
  }
};

/** First-party event without IP or cookies. */
export async function recordLinkEvent(db: Db, e: { organizationId: string; workspaceId: string; kind: "page_view" | "block_click" | "grid_click" | "short_click"; startPageId?: string; blockId?: string; shortLinkId?: string; userAgent: string | null; referrer: string | null; now?: Date }) {
  await db.insert(schema.linkEvents).values({ organizationId: e.organizationId, workspaceId: e.workspaceId, kind: e.kind, startPageId: e.startPageId, blockId: e.blockId, shortLinkId: e.shortLinkId, device: deviceClass(e.userAgent), referrerHost: refHost(e.referrer), day: (e.now ?? new Date()).toISOString().slice(0, 10) });
}

/** Resolve a public click target from the snapshot (never from user input → no open redirect). */
export function resolveClickTarget(snap: StartPageSnapshot, blockId: string, index?: number): string | null {
  const g = snap.grid.find((x) => x.id === blockId);
  if (g) return g.targetUrl;
  const b = snap.blocks.find((x) => x.id === blockId);
  if (!b) return null;
  if (b.type === "button") return String(b.data.url);
  if (b.type === "image") return (b.data.url as string | undefined) ?? null;
  if (b.type === "image_grid") return ((b.data.items as { url?: string }[])[index ?? -1]?.url as string | undefined) ?? null;
  if (b.type === "social_links") {
    const l = (b.data.links as { network: string; url: string }[])[index ?? -1];
    if (!l) return null;
    return l.network === "email" ? `mailto:${l.url.replace(/^mailto:/, "")}` : /^https?:\/\//.test(l.url) ? l.url : null;
  }
  return null;
}

export async function startPageStats(db: Db, actor: Actor, pageId: string, days = 30) {
  const page = await loadPage(db, actor, pageId);
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const rows = await db
    .select({ kind: schema.linkEvents.kind, blockId: schema.linkEvents.blockId, day: schema.linkEvents.day, device: schema.linkEvents.device, n: sql<number>`count(*)::int` })
    .from(schema.linkEvents)
    .where(and(eq(schema.linkEvents.startPageId, page.id), gte(schema.linkEvents.day, since), sql`${schema.linkEvents.device} <> 'bot'`))
    .groupBy(schema.linkEvents.kind, schema.linkEvents.blockId, schema.linkEvents.day, schema.linkEvents.device);
  const views = rows.filter((r) => r.kind === "page_view").reduce((s, r) => s + r.n, 0);
  const clicksByBlock = new Map<string, number>();
  for (const r of rows.filter((x) => x.kind !== "page_view" && x.blockId)) clicksByBlock.set(r.blockId!, (clicksByBlock.get(r.blockId!) ?? 0) + r.n);
  const clicks = [...clicksByBlock.values()].reduce((a, b) => a + b, 0);
  const byDay = new Map<string, number>();
  for (const r of rows.filter((x) => x.kind === "page_view")) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.n);
  return { views, clicks, ctr: views ? Math.round((clicks / views) * 1000) / 10 : null, clicksByBlock: Object.fromEntries(clicksByBlock), viewsByDay: [...byDay.entries()].sort().map(([day, value]) => ({ day, value })), since };
}

