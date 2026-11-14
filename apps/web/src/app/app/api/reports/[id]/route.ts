import { getReportFile, isAppError } from "@sichttakt/core";
import { requireContext } from "@/lib/server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  try {
    const f = await getReportFile(ctx.svc.db, ctx.svc.storage, ctx.actor, id);
    return new Response(new Uint8Array(f.data), { headers: { "content-type": f.contentType, "content-disposition": `${new URL(req.url).searchParams.get("inline") === "1" && f.contentType === "application/pdf" ? "inline" : "attachment"}; filename="${encodeURIComponent(f.filename)}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (isAppError(e)) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
