import { IMPORT_TEMPLATE_CSV } from "@sichttakt/core";
import { requireContext } from "@/lib/server";

export async function GET() {
  await requireContext();
  return new Response(IMPORT_TEMPLATE_CSV, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="sichttakt-import-vorlage.csv"' } });
}
