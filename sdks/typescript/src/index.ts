// SichtTakt Public API v1 — TypeScript / JavaScript SDK (Node 18+, Deno, Bun, edge runtimes).
// Zero dependencies: uses global fetch + Web Crypto. Server-side only — never ship an API key to a browser.

export type SichtTaktOptions = {
  apiKey: string;
  /** Default https://api.sichttakt.de */
  baseUrl?: string;
  /** Retries for 429 / 5xx / network errors (writes reuse the same Idempotency-Key, so retries are safe). Default 2. */
  maxRetries?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export class SichtTaktError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown,
    readonly requestId: string | null,
    readonly retryAfter: number | null,
  ) {
    super(`${code}: ${message}`);
    this.name = "SichtTaktError";
  }
}

export type PostType = "text" | "image" | "video" | "carousel" | "story" | "reel" | "short" | "document" | "thread";
export type CreatePostInput = {
  workspace_id: string;
  account_ids: string[];
  type: PostType;
  caption?: string;
  media_asset_ids?: string[];
  video_asset_id?: string;
  cover_asset_id?: string;
  cover_mode?: "video_frame" | "independent_image";
  thumb_offset_ms?: number;
  scheduled_at?: string;
  timezone?: string;
  status?: "draft" | "scheduled";
  queue?: boolean;
  publish_mode?: "automatic" | "notification";
  targets?: { account_id: string; caption?: string; publish_mode?: string; share_to_feed?: boolean; first_comment?: string }[];
  tags?: string[];
  external_ref?: string;
};
export type WebhookEvent = string;

type Req = { query?: Record<string, string | undefined>; body?: unknown; raw?: { data: ArrayBuffer | Uint8Array | Blob; contentType: string }; idempotencyKey?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export class SichtTakt {
  private readonly base: string;
  private readonly f: typeof fetch;

  constructor(private readonly opts: SichtTaktOptions) {
    if (!opts.apiKey?.startsWith("st_")) throw new Error("SichtTakt: apiKey must start with st_live_ or st_test_");
    this.base = (opts.baseUrl ?? "https://api.sichttakt.de").replace(/\/$/, "");
    this.f = opts.fetch ?? fetch;
  }

  /** Low-level request. Writes get an Idempotency-Key automatically (pass your own to make retries across processes safe). */
  async request<T = unknown>(method: string, path: string, r: Req = {}): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(r.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
    const write = method !== "GET";
    const key = write ? (r.idempotencyKey ?? uuid()) : undefined;
    const headers: Record<string, string> = { authorization: `Bearer ${this.opts.apiKey}`, accept: "application/json", "user-agent": "sichttakt-ts/0.1.0" };
    if (key) headers["idempotency-key"] = key;
    let body: BodyInit | undefined;
    if (r.raw) {
      headers["content-type"] = r.raw.contentType;
      body = r.raw.data as BodyInit;
    } else if (r.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(r.body);
    }
    const max = this.opts.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.f(url, { method, headers, body, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000) });
      } catch (e) {
        if (attempt < max) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw e;
      }
      if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
      const retryAfter = Number(res.headers.get("retry-after")) || null;
      if ((res.status === 429 || res.status >= 500) && attempt < max) {
        await sleep(retryAfter ? retryAfter * 1000 : 500 * 2 ** attempt);
        continue;
      }
      const j = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; details?: unknown; request_id?: string } };
      throw new SichtTaktError(res.status, j.error?.code ?? `HTTP_${res.status}`, j.error?.message ?? res.statusText, j.error?.details ?? null, j.error?.request_id ?? res.headers.get("x-request-id"), retryAfter);
    }
  }

  workspaces = { list: () => this.request<{ data: { id: string; name: string; timezone: string; approval_required: boolean }[] }>("GET", "/api/v1/workspaces") };

  accounts = {
    list: (workspaceId?: string) => this.request<{ data: unknown[] }>("GET", "/api/v1/accounts", { query: { workspace_id: workspaceId } }),
    connect: (p: { workspace_id: string; platform: string; redirect_after?: string }) => this.request<{ authorization_url: string; expires_in: number }>("POST", "/api/v1/accounts/connect", { body: p }),
    getSlots: (accountId: string) => this.request("GET", `/api/v1/accounts/${encodeURIComponent(accountId)}/slots`),
    setSlots: (accountId: string, body: unknown) => this.request("PUT", `/api/v1/accounts/${encodeURIComponent(accountId)}/slots`, { body }),
  };

  media = {
    /** Two-step upload: register, then PUT the bytes. Returns the validated asset. */
    upload: async (p: { workspace_id: string; filename: string; mime_type: string; data: ArrayBuffer | Uint8Array | Blob; purpose?: "video" | "cover" | "image" }) => {
      const size = p.data instanceof Blob ? p.data.size : p.data.byteLength;
      const reg = await this.request<{ id: string }>("POST", "/api/v1/media/uploads", { body: { workspace_id: p.workspace_id, filename: p.filename, mime_type: p.mime_type, size_bytes: size, purpose: p.purpose ?? "image" } });
      return this.request<{ id: string; status: string }>("PUT", `/api/v1/media/${reg.id}/content`, { raw: { data: p.data, contentType: p.mime_type } });
    },
    get: (id: string) => this.request("GET", `/api/v1/media/${encodeURIComponent(id)}`),
  };

  posts = {
    create: (p: CreatePostInput, idempotencyKey?: string) => this.request<{ id: string; status: string }>("POST", "/api/v1/posts", { body: p, idempotencyKey }),
    get: (id: string) => this.request("GET", `/api/v1/posts/${encodeURIComponent(id)}`),
    update: (id: string, p: Partial<CreatePostInput>) => this.request("PATCH", `/api/v1/posts/${encodeURIComponent(id)}`, { body: p }),
    approve: (id: string, p: { decision: "approved" | "changes_requested"; comment?: string }) => this.request("POST", `/api/v1/posts/${encodeURIComponent(id)}/approve`, { body: p }),
    publish: (id: string) => this.request("POST", `/api/v1/posts/${encodeURIComponent(id)}/publish`, { body: {} }),
    cancel: (id: string) => this.request("POST", `/api/v1/posts/${encodeURIComponent(id)}/cancel`, { body: {} }),
    reschedule: (id: string, scheduledAt: string) => this.request("POST", `/api/v1/posts/${encodeURIComponent(id)}/reschedule`, { body: { scheduled_at: scheduledAt } }),
    clone: (id: string) => this.request("POST", `/api/v1/posts/${encodeURIComponent(id)}/clone`, { body: {} }),
  };

  calendar = { list: (p: { workspace_id: string; from: string; to: string }) => this.request<{ data: unknown[] }>("GET", "/api/v1/calendar", { query: p }) };
  analytics = { post: (postId: string) => this.request("GET", `/api/v1/analytics/posts/${encodeURIComponent(postId)}`) };
  links = { create: (p: { workspace_id: string; url: string }) => this.request<{ id: string; code: string; short_url: string; target_url: string; clicks: number }>("POST", "/api/v1/links", { body: p }) };
  usage = { get: () => this.request("GET", "/api/v1/usage") };

  webhooks = {
    list: () => this.request<{ data: unknown[] }>("GET", "/api/v1/webhooks"),
    create: (p: { url: string; events: WebhookEvent[]; workspace_id?: string; description?: string }) => this.request<{ id: string; secret: string }>("POST", "/api/v1/webhooks", { body: p }),
    delete: (id: string) => this.request("DELETE", `/api/v1/webhooks/${encodeURIComponent(id)}`),
  };
}

/**
 * Verifies a webhook delivery. Pass the RAW request body (not re-serialised JSON) and the
 * `SichtTakt-Signature` header (`t=<unix>,v1=<hex>`). Rejects signatures older than 5 minutes.
 */
export async function verifyWebhook(secret: string, rawBody: string, header: string | null, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(nowSec - t) > 300) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}
