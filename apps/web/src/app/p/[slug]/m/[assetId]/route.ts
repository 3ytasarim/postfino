import { and, eq, isNull, schema } from "@sichttakt/db";
import { getPublishedPage, snapshotHasAsset } from "@sichttakt/core";
import { services } from "@/lib/server";

// Public media for a published Start Page: only assets referenced by the current snapshot are served.
export async function GET(_: Request, { params }: { params: Promise<{ slug: string; assetId: string }> }) {
  const { slug, assetId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return new Response("Not found", { status: 404 });
  const svc = services();
  const p = await getPublishedPage(svc.db, slug);
  if (!p || !snapshotHasAsset(p.snapshot, assetId)) return new Response("Not found", { status: 404 });
  const [a] = await svc.db
    .select()
    .from(schema.mediaAssets)
    .where(and(eq(schema.mediaAssets.id, assetId), eq(schema.mediaAssets.organizationId, p.page.organizationId), isNull(schema.mediaAssets.deletedAt)));
  if (!a || a.status !== "ready") return new Response("Not found", { status: 404 });
  const data = await svc.storage.get(a.storageKey);
  return new Response(new Uint8Array(data), {
    headers: { "content-type": a.mimeType, "cache-control": "public, max-age=300, stale-while-revalidate=3600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" },
  });
}
