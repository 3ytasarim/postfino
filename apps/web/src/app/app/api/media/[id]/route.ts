import { getAsset, isAppError } from "@sichttakt/core";
import { requireContext } from "@/lib/server";

// Authenticated media preview for the app (draft Start Page preview, pickers). Tenant + workspace checked by getAsset.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  try {
    const a = await getAsset(ctx.svc.db, ctx.actor, id);
    if (a.status !== "ready") return new Response("Not ready", { status: 404 });
    const data = await ctx.svc.storage.get(a.storageKey);
    return new Response(new Uint8Array(data), { headers: { "content-type": a.mimeType, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } });
  } catch (e) {
    if (isAppError(e)) return new Response("Not found", { status: 404 });
    throw e;
  }
}
