import { and, asc, eq, sql, schema, type Db } from "@sichttakt/db";
import { AppError, type PostType } from "@sichttakt/shared";
import { loadWorkspace, authorize } from "./tenancy";
import { loadAssetsInWorkspace } from "./media";
import { createPost } from "./posts";
import { audit } from "./audit";
import type { AdapterRegistry } from "./channels";
import type { Actor } from "./rbac";

// Create / Ideas: boards with columns, idea cards (title, text, links, media, tags),
// templates, conversion idea → draft post. Ideas are channel-independent (like a backlog).

export const DEFAULT_COLUMNS = [
  { id: "inbox", name: "Eingang" },
  { id: "progress", name: "In Arbeit" },
  { id: "ready", name: "Bereit" },
];
const MAX_IDEAS_PER_WORKSPACE = 5000;

export async function ensureDefaultBoard(db: Db, actor: Actor, workspaceId: string) {
  await loadWorkspace(db, actor, workspaceId, "posts.read");
  const [b] = await db.select().from(schema.ideaBoards).where(eq(schema.ideaBoards.workspaceId, workspaceId)).limit(1);
  if (b) return b;
  const [created] = await db.insert(schema.ideaBoards).values({ organizationId: actor.organizationId, workspaceId, name: "Ideen", columns: DEFAULT_COLUMNS }).returning();
  return created!;
}

export async function listBoards(db: Db, actor: Actor, workspaceId: string) {
  await ensureDefaultBoard(db, actor, workspaceId);
  return db.select().from(schema.ideaBoards).where(and(eq(schema.ideaBoards.workspaceId, workspaceId), eq(schema.ideaBoards.organizationId, actor.organizationId)));
}

export async function updateBoardColumns(db: Db, actor: Actor, boardId: string, columns: { id: string; name: string }[]) {
  const [b] = await db.select().from(schema.ideaBoards).where(and(eq(schema.ideaBoards.id, boardId), eq(schema.ideaBoards.organizationId, actor.organizationId)));
  if (!b) throw new AppError("NOT_FOUND", "Board not found");
  authorize(actor, b.workspaceId, "ideas.write");
  if (columns.length < 1 || columns.length > 12 || columns.some((c) => !c.id || !c.name.trim())) throw new AppError("VALIDATION_FAILED", "1–12 named columns required");
  await db.update(schema.ideaBoards).set({ columns }).where(eq(schema.ideaBoards.id, b.id));
  // Ideas in removed columns fall back to the first column (never lost).
  const ids = columns.map((c) => c.id);
  await db.update(schema.contentIdeas).set({ columnId: ids[0]! }).where(and(eq(schema.contentIdeas.boardId, b.id), sql`${schema.contentIdeas.columnId} is null or ${schema.contentIdeas.columnId} not in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`));
}

export type IdeaInput = { workspaceId: string; boardId?: string; columnId?: string; title: string; body?: string; links?: string[]; mediaAssetIds?: string[]; tags?: string[]; source?: string; sourceRef?: string };

export async function createIdea(db: Db, actor: Actor, p: IdeaInput) {
  await loadWorkspace(db, actor, p.workspaceId, "ideas.write");
  const title = p.title.trim();
  if (!title || title.length > 300) throw new AppError("VALIDATION_FAILED", "Title required (max 300)");
  const links = (p.links ?? []).filter(Boolean).slice(0, 20);
  for (const l of links) if (!/^https?:\/\//.test(l)) throw new AppError("VALIDATION_FAILED", `Invalid link ${l}`);
  if (p.mediaAssetIds?.length) await loadAssetsInWorkspace(db, actor.organizationId, p.workspaceId, p.mediaAssetIds.slice(0, 10));
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.contentIdeas).where(eq(schema.contentIdeas.workspaceId, p.workspaceId));
  if (n >= MAX_IDEAS_PER_WORKSPACE) throw new AppError("QUOTA_EXCEEDED", `Max ${MAX_IDEAS_PER_WORKSPACE} ideas per workspace`);
  const board = p.boardId ? await getBoard(db, actor, p.boardId) : await ensureDefaultBoard(db, actor, p.workspaceId);
  if (board.workspaceId !== p.workspaceId) throw new AppError("NOT_FOUND", "Board not found");
  const columnId = p.columnId && board.columns.some((c) => c.id === p.columnId) ? p.columnId : board.columns[0]?.id;
  const [{ max } = { max: 0 }] = await db.select({ max: sql<number>`coalesce(max(${schema.contentIdeas.position}), 0)::int` }).from(schema.contentIdeas).where(and(eq(schema.contentIdeas.boardId, board.id), eq(schema.contentIdeas.columnId, columnId ?? "")));
  const rows = await db
    .insert(schema.contentIdeas)
    .values({
      organizationId: actor.organizationId,
      workspaceId: p.workspaceId,
      boardId: board.id,
      columnId,
      position: max + 1,
      title,
      body: (p.body ?? "").slice(0, 10_000),
      links,
      mediaAssetIds: p.mediaAssetIds?.slice(0, 10) ?? [],
      source: p.source ?? "manual",
      sourceRef: p.sourceRef,
      createdByUserId: actor.kind === "user" ? actor.userId : null,
    })
    .onConflictDoNothing()
    .returning();
  const idea = rows[0];
  if (!idea) return null; // duplicate source item (RSS / extension) — idempotent
  if (p.tags?.length) await setIdeaTags(db, actor, idea.id, p.tags);
  return idea;
}

async function getBoard(db: Db, actor: Actor, boardId: string) {
  const [b] = await db.select().from(schema.ideaBoards).where(and(eq(schema.ideaBoards.id, boardId), eq(schema.ideaBoards.organizationId, actor.organizationId)));
  if (!b) throw new AppError("NOT_FOUND", "Board not found");
  authorize(actor, b.workspaceId, "posts.read");
  return b;
}

export async function getIdea(db: Db, actor: Actor, ideaId: string) {
  const [i] = await db.select().from(schema.contentIdeas).where(and(eq(schema.contentIdeas.id, ideaId), eq(schema.contentIdeas.organizationId, actor.organizationId)));
  if (!i) throw new AppError("NOT_FOUND", "Idea not found");
  authorize(actor, i.workspaceId, "posts.read");
  return i;
}

export async function updateIdea(db: Db, actor: Actor, ideaId: string, p: { title?: string; body?: string; links?: string[]; tags?: string[] }) {
  const i = await getIdea(db, actor, ideaId);
  authorize(actor, i.workspaceId, "ideas.write");
  await db
    .update(schema.contentIdeas)
    .set({ title: p.title?.trim() || i.title, body: p.body ?? i.body, links: p.links ?? i.links, updatedAt: new Date() })
    .where(eq(schema.contentIdeas.id, i.id));
  if (p.tags) await setIdeaTags(db, actor, i.id, p.tags);
  return getIdea(db, actor, i.id);
}

/** Kanban move: column + position (dense re-numbering of the target column). */
export async function moveIdea(db: Db, actor: Actor, ideaId: string, columnId: string, index: number) {
  const i = await getIdea(db, actor, ideaId);
  authorize(actor, i.workspaceId, "ideas.write");
  const b = await getBoard(db, actor, i.boardId!);
  if (!b.columns.some((c) => c.id === columnId)) throw new AppError("VALIDATION_FAILED", "Unknown column");
  const siblings = (await db.select({ id: schema.contentIdeas.id }).from(schema.contentIdeas).where(and(eq(schema.contentIdeas.boardId, b.id), eq(schema.contentIdeas.columnId, columnId))).orderBy(asc(schema.contentIdeas.position))).map((r) => r.id).filter((id) => id !== i.id);
  siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, i.id);
  await db.transaction(async (tx) => {
    for (const [pos, id] of siblings.entries()) await tx.update(schema.contentIdeas).set({ columnId, position: pos + 1, updatedAt: new Date() }).where(eq(schema.contentIdeas.id, id));
  });
}

export async function deleteIdea(db: Db, actor: Actor, ideaId: string) {
  const i = await getIdea(db, actor, ideaId);
  authorize(actor, i.workspaceId, "ideas.write");
  await db.delete(schema.contentIdeas).where(eq(schema.contentIdeas.id, i.id));
  await audit(db, { organizationId: i.organizationId, workspaceId: i.workspaceId, actor, action: "idea.deleted", targetType: "idea", targetId: i.id });
}

export async function listIdeas(db: Db, actor: Actor, workspaceId: string, p: { boardId?: string; tag?: string; q?: string } = {}) {
  await loadWorkspace(db, actor, workspaceId, "posts.read");
  const rows = await db
    .select()
    .from(schema.contentIdeas)
    .where(and(eq(schema.contentIdeas.workspaceId, workspaceId), eq(schema.contentIdeas.organizationId, actor.organizationId), p.boardId ? eq(schema.contentIdeas.boardId, p.boardId) : undefined))
    .orderBy(asc(schema.contentIdeas.position));
  const q = p.q?.toLowerCase();
  return rows.filter((r) => (!p.tag || r.tags.includes(p.tag)) && (!q || `${r.title} ${r.body}`.toLowerCase().includes(q)));
}

// ── Tags (workspace scoped, case-insensitive unique; max 250 per workspace) ──
export async function setIdeaTags(db: Db, actor: Actor, ideaId: string, tags: string[]) {
  const i = await getIdea(db, actor, ideaId);
  authorize(actor, i.workspaceId, "ideas.write");
  const clean = [...new Set(tags.map((t) => t.trim().replace(/^#/, "")).filter(Boolean))].slice(0, 30);
  for (const t of clean) await ensureTag(db, actor, i.workspaceId, t);
  await db.update(schema.contentIdeas).set({ tags: clean, updatedAt: new Date() }).where(eq(schema.contentIdeas.id, i.id));
}

export async function ensureTag(db: Db, actor: Actor, workspaceId: string, name: string, color?: string) {
  if (name.length > 60) throw new AppError("VALIDATION_FAILED", "Tag too long");
  const [existing] = await db.select().from(schema.contentTags).where(and(eq(schema.contentTags.workspaceId, workspaceId), sql`lower(${schema.contentTags.name}) = ${name.toLowerCase()}`));
  if (existing) return existing;
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.contentTags).where(eq(schema.contentTags.workspaceId, workspaceId));
  if (n >= 250) throw new AppError("QUOTA_EXCEEDED", "Max 250 tags per workspace");
  const [t] = await db.insert(schema.contentTags).values({ organizationId: actor.organizationId, workspaceId, name, color: color ?? "#0047ab" }).onConflictDoNothing().returning();
  return t ?? (await db.select().from(schema.contentTags).where(and(eq(schema.contentTags.workspaceId, workspaceId), sql`lower(${schema.contentTags.name}) = ${name.toLowerCase()}`)))[0]!;
}

export async function listTags(db: Db, actor: Actor, workspaceId: string) {
  await loadWorkspace(db, actor, workspaceId, "posts.read");
  return db.select().from(schema.contentTags).where(eq(schema.contentTags.workspaceId, workspaceId)).orderBy(asc(schema.contentTags.name));
}

/** Idea → draft post (title is NOT carried over, like the reference product; body + links become the caption). */
export async function convertIdeaToPost(db: Db, registry: AdapterRegistry, actor: Actor, ideaId: string, p: { accountIds: string[]; type: PostType }) {
  const i = await getIdea(db, actor, ideaId);
  authorize(actor, i.workspaceId, "posts.write");
  const caption = [i.body.trim(), ...i.links].filter(Boolean).join("\n\n");
  const media = i.mediaAssetIds;
  const isVideo = p.type === "video" || p.type === "reel";
  const r = await createPost(db, registry, actor, {
    workspace_id: i.workspaceId,
    account_ids: p.accountIds,
    type: p.type,
    caption,
    media_asset_ids: isVideo ? [] : media,
    video_asset_id: isVideo ? media[0] : undefined,
    status: "draft",
    publish_mode: "automatic",
    tags: i.tags,
  });
  await db.update(schema.posts).set({ ideaId: i.id }).where(eq(schema.posts.id, r.post.id));
  await audit(db, { organizationId: i.organizationId, workspaceId: i.workspaceId, actor, action: "idea.converted", targetType: "post", targetId: r.post.id, metadata: { ideaId: i.id } });
  return r.post;
}

// ── Templates ──
export async function listTemplates(db: Db, actor: Actor, workspaceId: string) {
  await loadWorkspace(db, actor, workspaceId, "posts.read");
  return db.select().from(schema.contentTemplates).where(eq(schema.contentTemplates.workspaceId, workspaceId)).orderBy(asc(schema.contentTemplates.name));
}

export async function saveTemplate(db: Db, actor: Actor, p: { workspaceId: string; id?: string; name: string; kind: "caption" | "hashtags" | "first_comment"; body: string }) {
  await loadWorkspace(db, actor, p.workspaceId, "ideas.write");
  if (!p.name.trim() || !p.body.trim() || p.body.length > 5000) throw new AppError("VALIDATION_FAILED", "Name and body (max 5000) required");
  if (p.id) {
    const [t] = await db
      .update(schema.contentTemplates)
      .set({ name: p.name.trim(), kind: p.kind, body: p.body, updatedAt: new Date() })
      .where(and(eq(schema.contentTemplates.id, p.id), eq(schema.contentTemplates.workspaceId, p.workspaceId), eq(schema.contentTemplates.organizationId, actor.organizationId)))
      .returning();
    if (!t) throw new AppError("NOT_FOUND", "Template not found");
    return t;
  }
  const [t] = await db
    .insert(schema.contentTemplates)
    .values({ organizationId: actor.organizationId, workspaceId: p.workspaceId, name: p.name.trim(), kind: p.kind, body: p.body, createdByUserId: actor.kind === "user" ? actor.userId : null })
    .returning();
  return t!;
}

export async function deleteTemplate(db: Db, actor: Actor, id: string) {
  const [t] = await db.select().from(schema.contentTemplates).where(and(eq(schema.contentTemplates.id, id), eq(schema.contentTemplates.organizationId, actor.organizationId)));
  if (!t) throw new AppError("NOT_FOUND", "Template not found");
  authorize(actor, t.workspaceId, "ideas.write");
  await db.delete(schema.contentTemplates).where(eq(schema.contentTemplates.id, t.id));
}

/** Fills {{variables}} in a template; unknown variables stay visible so nothing is silently dropped. */
export const renderTemplate = (body: string, vars: Record<string, string>) => body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
