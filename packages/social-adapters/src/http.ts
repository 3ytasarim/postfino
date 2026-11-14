import { ProviderError, type HttpFetch, type MediaInfo, type ProviderCallLog } from "./types";

// Shared plumbing for the REST adapters (LinkedIn, TikTok, YouTube, X, Threads, Pinterest, Bluesky, Mastodon,
// Google Business). Every provider call goes through `call()` so that errors are classified the same way:
//   network failure  → ProviderError(retryable, "NETWORK")  — the publisher never re-sends a direct publish then
//   429 / 5xx        → ProviderError(retryable)
//   other 4xx        → ProviderError(final) with the provider's own error code/message

export type CallOptions = {
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  json?: unknown;
  form?: Record<string, string | undefined>;
  body?: BodyInit;
  /** Log step name; request bodies are summarised, tokens never logged. */
  step?: string;
  log?: (l: ProviderCallLog) => void;
  /** Return the raw Response (for headers such as x-restli-id / Location). */
  raw?: boolean;
  timeoutMs?: number;
};

const redact = (u: string) => u.replace(/(access_token|client_secret|refresh_token|code)=[^&]+/g, "$1=***");

export async function call<T = unknown>(http: HttpFetch, method: string, url: string, o: CallOptions = {}): Promise<T> {
  const u = new URL(url);
  for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
  const headers: Record<string, string> = { accept: "application/json", ...(o.headers ?? {}) };
  let body: BodyInit | undefined = o.body;
  if (o.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(o.json);
  } else if (o.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(Object.entries(o.form).filter((e): e is [string, string] => e[1] !== undefined)).toString();
  }
  const started = Date.now();
  let res: Response;
  try {
    res = await http(u, { method, headers, body, signal: AbortSignal.timeout(o.timeoutMs ?? 60_000) });
  } catch (e) {
    throw new ProviderError(`network error: ${(e as Error).message}`, true, "NETWORK");
  }
  if (o.raw && res.ok) {
    o.log?.({ step: o.step ?? method, request: { method, url: redact(u.toString()) }, response: { status: res.status }, durationMs: Date.now() - started });
    return res as unknown as T;
  }
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = { text: text.slice(0, 500) };
  }
  o.log?.({ step: o.step ?? method, request: { method, url: redact(u.toString()) }, response: { status: res.status, body: summarize(data) }, durationMs: Date.now() - started });
  if (!res.ok) {
    const { code, message } = extractError(data, res.status);
    throw new ProviderError(message, res.status === 429 || res.status >= 500, code, data);
  }
  return data as T;
}

function summarize(d: unknown): unknown {
  const s = JSON.stringify(d ?? null);
  return s.length > 800 ? `${s.slice(0, 800)}…` : d;
}

/** Normalises the many error envelopes (OAuth, Google, LinkedIn, X, TikTok, Pinterest, AT Protocol, Mastodon). */
export function extractError(d: unknown, status: number): { code: string; message: string } {
  const o = (d ?? {}) as Record<string, any>;
  if (o.error && typeof o.error === "object") {
    const e = o.error;
    // TikTok returns error.code "ok" on success-shaped errors; Google: {code,message,status}
    return { code: String(e.code ?? e.status ?? status), message: String(e.message ?? e.error_user_msg ?? JSON.stringify(e)).slice(0, 500) };
  }
  if (typeof o.error === "string") return { code: o.error, message: String(o.error_description ?? o.message ?? o.error) };
  if (o.errors && Array.isArray(o.errors) && o.errors[0]) return { code: String(o.errors[0].code ?? o.title ?? status), message: String(o.errors[0].message ?? o.detail ?? o.title) };
  if (o.title || o.detail) return { code: String(o.type ?? o.title ?? status), message: String(o.detail ?? o.title) };
  if (o.serviceErrorCode || o.message) return { code: String(o.serviceErrorCode ?? o.code ?? status), message: String(o.message) };
  return { code: `HTTP_${status}`, message: `HTTP ${status}` };
}

/** Downloads our own signed media URL so it can be pushed to providers that do not pull from URLs. */
export async function fetchMediaBytes(http: HttpFetch, m: MediaInfo, maxBytes: number): Promise<Uint8Array> {
  if (!m.publicUrl) throw new ProviderError("media has no URL", false, "MEDIA_URL_MISSING");
  if (m.sizeBytes > maxBytes) throw new ProviderError(`media too large (${m.sizeBytes} > ${maxBytes})`, false, "MEDIA_TOO_LARGE");
  let res: Response;
  try {
    res = await http(m.publicUrl, { signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    throw new ProviderError(`media download failed: ${(e as Error).message}`, true, "MEDIA_FETCH");
  }
  if (!res.ok) throw new ProviderError(`media download HTTP ${res.status}`, res.status >= 500, "MEDIA_FETCH");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new ProviderError("media too large", false, "MEDIA_TOO_LARGE");
  return buf;
}

export const basicAuth = (id: string, secret: string) => `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64")}`;

export const expiresIn = (seconds: number | undefined) => (seconds ? new Date(Date.now() + seconds * 1000) : undefined);

/** Thread parts: a line containing only "---" separates posts (X, Threads, Bluesky, Mastodon). */
export function splitThread(caption: string): string[] {
  return caption
    .split(/\r?\n-{3,}\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** User-perceived characters (Bluesky limits graphemes, not UTF-16 units). */
export function graphemes(s: string): number {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  if (!Seg) return [...s].length;
  let n = 0;
  for (const _ of new Seg(undefined, { granularity: "grapheme" }).segment(s)) n++;
  return n;
}

export const firstLine = (caption: string, max: number) => (caption.split(/\r?\n/).find((l) => l.trim()) ?? "").trim().slice(0, max);

/** Direct-publish marker carrying pre-uploaded media references (see publisher.ts: never re-sent after an unknown outcome). */
export const directMarker = (data: Record<string, unknown> = {}) => `direct:${JSON.stringify(data)}`;
export function parseDirect<T extends Record<string, unknown>>(containerId: string): T {
  if (!containerId.startsWith("direct:")) throw new ProviderError("unexpected container id", false, "INTERNAL");
  const raw = containerId.slice(7);
  return (raw.startsWith("{") ? JSON.parse(raw) : {}) as T;
}
