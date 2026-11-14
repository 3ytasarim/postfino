import { getPublishedPage, recordLinkEvent, resolveClickTarget } from "@sichttakt/core";
import { services } from "@/lib/server";

// Tracked click on a Start Page block / Shop Grid tile. The target comes from the published snapshot only,
// never from the query string, so this cannot be abused as an open redirect.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const svc = services();
  const p = await getPublishedPage(svc.db, slug);
  if (!p) return new Response("Not found", { status: 404 });
  const iRaw = new URL(req.url).searchParams.get("i");
  const index = iRaw !== null && /^\d{1,2}$/.test(iRaw) ? Number(iRaw) : undefined;
  const target = resolveClickTarget(p.snapshot, id, index);
  if (!target) return new Response("Not found", { status: 404 });
  const isGrid = p.snapshot.grid.some((g) => g.id === id);
  await recordLinkEvent(svc.db, { organizationId: p.page.organizationId, workspaceId: p.page.workspaceId, kind: isGrid ? "grid_click" : "block_click", startPageId: p.page.id, blockId: id, userAgent: req.headers.get("user-agent"), referrer: req.headers.get("referer") }).catch(() => {});
  return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store", "referrer-policy": "strict-origin-when-cross-origin" } });
}
