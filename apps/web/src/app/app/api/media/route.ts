import { NextResponse } from "next/server";
import { createMediaAsset, storeMediaContent, isAppError } from "@sichttakt/core";
import { requireContext } from "@/lib/server";

// Same-origin upload endpoint for the web UI (session cookie auth). The public API has its own
// two-step upload (POST /api/v1/media/uploads → PUT content). Large-file streaming to object storage
// replaces this in production (docs/ARCHITECTURE.md §Media).

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "cross-origin upload rejected" }, { status: 403 });
  const ctx = await requireContext();
  const fd = await req.formData();
  const file = fd.get("file");
  const purpose = String(fd.get("purpose") ?? "image") as "video" | "cover" | "image";
  if (!(file instanceof File)) return NextResponse.json({ error: "file missing" }, { status: 400 });
  try {
    const asset = await createMediaAsset(ctx.svc.db, ctx.actor, { workspaceId: ctx.workspace.id, filename: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, purpose });
    const stored = await storeMediaContent(ctx.svc.db, ctx.svc.storage, ctx.actor, asset.id, Buffer.from(await file.arrayBuffer()), { ffprobePath: ctx.svc.config.FFPROBE_PATH, clamavHost: ctx.svc.config.CLAMAV_HOST, clamavPort: ctx.svc.config.CLAMAV_PORT });
    return NextResponse.json({ id: stored.id, status: stored.status, errors: stored.validationErrors, width: stored.width, height: stored.height, durationMs: stored.durationMs, probe: stored.probe });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
