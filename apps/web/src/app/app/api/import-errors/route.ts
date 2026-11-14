import { getImport, importErrorsCsv } from "@sichttakt/core";
import { requireContext } from "@/lib/server";

export async function GET(req: Request) {
  const ctx = await requireContext();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const imp = await getImport(ctx.svc.db, ctx.actor, id);
  return new Response(importErrorsCsv(imp), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="import-fehler-${imp.id.slice(0, 8)}.csv"` } });
}
