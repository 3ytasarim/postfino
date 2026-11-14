import { runAssistant, isAppError, AI_TASKS, type AiTask } from "@sichttakt/core";
import { requireContext } from "@/lib/server";

// Streams the assistant's suggestion as plain text. Errors before the first token are returned as JSON with a
// proper status; errors mid-stream are appended as a single "\n[[error:CODE]]" marker the client understands.

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return Response.json({ error: "cross-origin request rejected" }, { status: 403 });
  const ctx = await requireContext();
  const body = (await req.json().catch(() => ({}))) as { task?: string; input?: string; platform?: string; language?: string };
  if (!AI_TASKS.includes(body.task as AiTask)) return Response.json({ error: "unknown_task" }, { status: 422 });

  const enc = new TextEncoder();
  let started = false;
  let resolveFirst!: (v: Response) => void;
  const first = new Promise<Response>((r) => (resolveFirst = r));
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const respondStreaming = () => {
    if (!started) {
      started = true;
      resolveFirst(new Response(stream.readable, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-ai-generated": "true" } }));
    }
  };

  void runAssistant(
    ctx.svc.db,
    ctx.svc.ai,
    ctx.actor,
    { workspaceId: ctx.workspace.id, task: body.task as AiTask, input: String(body.input ?? ""), platform: body.platform, language: body.language, signal: req.signal },
    (delta) => {
      respondStreaming();
      void writer.write(enc.encode(delta));
    },
  )
    .then(async () => {
      respondStreaming();
      await writer.close();
    })
    .catch(async (e: unknown) => {
      const code = isAppError(e) ? e.code : "INTERNAL";
      if (!started) {
        started = true;
        resolveFirst(Response.json({ error: isAppError(e) ? e.message : "ai_failed", code }, { status: isAppError(e) ? e.status : 500 }));
        await writer.abort().catch(() => {});
        return;
      }
      await writer.write(enc.encode(`\n[[error:${code}]]`)).catch(() => {});
      await writer.close().catch(() => {});
    });

  return first;
}
