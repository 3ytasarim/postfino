import { resolveShortLink } from "@sichttakt/core";
import { services } from "@/lib/server";

// Short link redirect on our own domain. Counted first-party (no IP, no cookies). HEAD requests from
// link-preview crawlers are classified as bots by the user agent and excluded from statistics.
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const target = await resolveShortLink(services().db, code, { userAgent: req.headers.get("user-agent"), referrer: req.headers.get("referer") });
  if (!target) return new Response("Dieser Kurzlink existiert nicht oder wurde deaktiviert.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store" } });
}
