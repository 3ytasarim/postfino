// Minimal fake fetch for adapter contract tests: routes by method + URL prefix, records every request.
export type Recorded = { method: string; url: string; headers: Record<string, string>; body: unknown; rawBody?: BodyInit | null };
type Handler = (r: Recorded) => { status?: number; json?: unknown; headers?: Record<string, string>; text?: string; bytes?: Uint8Array };

export function fakeHttp(routes: [string, string | RegExp, Handler][]) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    let body: unknown = undefined;
    const raw = init?.body ?? null;
    if (typeof raw === "string") {
      try {
        body = JSON.parse(raw);
      } catch {
        body = Object.fromEntries(new URLSearchParams(raw));
      }
    } else if (raw instanceof FormData) {
      body = Object.fromEntries([...raw.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `[blob ${(v as Blob).size}]`]));
    } else if (raw) body = `[binary ${(raw as Uint8Array).byteLength ?? "?"}]`;
    const rec: Recorded = { method, url, headers, body, rawBody: raw };
    calls.push(rec);
    const route = routes.find(([m, u]) => (m === "*" || m === method) && (typeof u === "string" ? url.startsWith(u) : u.test(url)));
    if (!route) return new Response(JSON.stringify({ error: { message: `no fake route for ${method} ${url}` } }), { status: 599 });
    const r = route[2](rec);
    const status = r.status ?? 200;
    if (r.bytes) return new Response(r.bytes as BodyInit, { status, headers: r.headers });
    if (status === 204 || status === 304) return new Response(null, { status, headers: r.headers });
    return new Response(r.text ?? (r.json === undefined ? "" : JSON.stringify(r.json)), { status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls, find: (m: string, part: string) => calls.filter((c) => c.method === m && c.url.includes(part)) };
}

export const media = (o: Partial<{ kind: "image" | "video"; mimeType: string; sizeBytes: number; width: number; height: number; durationMs: number }> = {}) => ({
  assetId: crypto.randomUUID(),
  kind: o.kind ?? "image",
  mimeType: o.mimeType ?? (o.kind === "video" ? "video/mp4" : "image/jpeg"),
  sizeBytes: o.sizeBytes ?? 50_000,
  width: o.width ?? 1080,
  height: o.height ?? 1350,
  durationMs: o.durationMs,
  publicUrl: `https://media.test.invalid/${crypto.randomUUID()}`,
});

export const noLog = () => {};
