import "server-only";
import { and, eq, inArray, schema, type Db } from "@sichttakt/db";

export type Thumb = { assetId: string; kind: "image" | "video"; count: number };

/**
 * One preview per post: the independent cover if there is one, else the first media item (or the video).
 * Served by the authenticated /app/api/media/{id} route, so tenant isolation is unchanged.
 */
export async function postThumbs(db: Db, organizationId: string, postIds: string[]): Promise<Map<string, Thumb>> {
  const out = new Map<string, Thumb>();
  if (postIds.length === 0) return out;
  const rows = await db
    .select({ postId: schema.postMedia.postId, assetId: schema.postMedia.assetId, role: schema.postMedia.role, position: schema.postMedia.position, kind: schema.mediaAssets.kind, status: schema.mediaAssets.status })
    .from(schema.postMedia)
    .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, schema.postMedia.assetId))
    .where(and(inArray(schema.postMedia.postId, postIds), eq(schema.postMedia.organizationId, organizationId)));
  const rank = (r: { role: string; position: number }) => (r.role === "cover" ? 0 : r.role === "item" ? 1 + r.position : 100);
  for (const id of postIds) {
    const mine = rows.filter((r) => r.postId === id && r.status === "ready" && (r.kind === "image" || r.kind === "video")).sort((a, b) => rank(a) - rank(b));
    const first = mine[0];
    if (first) out.set(id, { assetId: first.assetId, kind: first.kind as "image" | "video", count: mine.filter((m) => m.role !== "cover").length });
  }
  return out;
}
