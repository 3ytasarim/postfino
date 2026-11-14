"use server";
import { and, desc, eq, ilike, isNull, or, schema } from "@sichttakt/db";
import { requireContext, listVisibleChannels } from "@/lib/server";

export type SearchHit = { kind: "post" | "channel" | "idea"; id: string; title: string; meta: string; href: string; platform?: string };

/** Command palette search, scoped to the active workspace (RBAC through listVisibleChannels / workspace filter). */
export async function searchAction(q: string): Promise<SearchHit[]> {
  const ctx = await requireContext();
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const db = ctx.svc.db;
  const [posts, ideas, channels] = await Promise.all([
    db
      .select({ id: schema.posts.id, caption: schema.posts.caption, status: schema.posts.status, type: schema.posts.type })
      .from(schema.posts)
      .where(and(eq(schema.posts.workspaceId, ctx.workspace.id), eq(schema.posts.organizationId, ctx.organization.id), isNull(schema.posts.deletedAt), ilike(schema.posts.caption, like)))
      .orderBy(desc(schema.posts.createdAt))
      .limit(6),
    db
      .select({ id: schema.contentIdeas.id, title: schema.contentIdeas.title })
      .from(schema.contentIdeas)
      .where(and(eq(schema.contentIdeas.workspaceId, ctx.workspace.id), or(ilike(schema.contentIdeas.title, like), ilike(schema.contentIdeas.body, like))))
      .limit(4),
    listVisibleChannels(ctx, ctx.workspace.id),
  ]);
  const lc = term.toLowerCase();
  return [
    ...channels.filter((c) => c.display_name.toLowerCase().includes(lc) || (c.username ?? "").toLowerCase().includes(lc)).slice(0, 4).map((c) => ({ kind: "channel" as const, id: c.id, title: c.display_name, meta: c.username ? `@${c.username}` : c.platform, href: `/app/channels/${c.id}/queue`, platform: c.platform })),
    ...posts.map((p) => ({ kind: "post" as const, id: p.id, title: p.caption.slice(0, 90) || "—", meta: `${p.type} · ${p.status}`, href: `/app/posts/${p.id}` })),
    ...ideas.map((i) => ({ kind: "idea" as const, id: i.id, title: i.title, meta: "Idee", href: `/app/ideas?idea=${i.id}` })),
  ];
}
