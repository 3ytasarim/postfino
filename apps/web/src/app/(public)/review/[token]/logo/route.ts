import { and, eq, schema } from "@sichttakt/db";
import { getReview, publicBranding } from "@sichttakt/core";
import { services } from "@/lib/server";

// White-label logo for the review portal: only for a valid review link, only the org's configured logo.
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const svc = services();
  const review = await getReview(svc.db, svc.storage, token);
  if (!review) return new Response("Not found", { status: 404 });
  const brand = await publicBranding(svc.db, review.organizationId);
  if (!brand.logoAssetId) return new Response("Not found", { status: 404 });
  const [a] = await svc.db.select().from(schema.mediaAssets).where(and(eq(schema.mediaAssets.id, brand.logoAssetId), eq(schema.mediaAssets.organizationId, review.organizationId)));
  if (!a || a.status !== "ready" || a.kind !== "image") return new Response("Not found", { status: 404 });
  const data = await svc.storage.get(a.storageKey);
  return new Response(new Uint8Array(data), { headers: { "content-type": a.mimeType, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } });
}
