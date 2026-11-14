import path from "node:path";
import { readFile } from "node:fs/promises";
import { findRoot } from "@/lib/paths";

// Fixed allowlist — never a path from the request.
const FILES: Record<string, { file: string; type: string }> = {
  "sichttakt.ts": { file: "sdks/typescript/src/index.ts", type: "text/plain; charset=utf-8" },
  "SichtTakt.php": { file: "sdks/php/src/SichtTakt.php", type: "text/plain; charset=utf-8" },
};

export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const f = FILES[name];
  if (!f) return new Response("Not found", { status: 404 });
  const body = await readFile(path.join(findRoot(), f.file), "utf8");
  return new Response(body, { headers: { "content-type": f.type, "content-disposition": `inline; filename="${name}"`, "x-content-type-options": "nosniff" } });
}
