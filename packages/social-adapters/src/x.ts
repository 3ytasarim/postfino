import { PLATFORM_CAPABILITIES } from "./capabilities";
import { basicAuth, call, directMarker, expiresIn, fetchMediaBytes, parseDirect, splitThread } from "./http";
import { CapabilityNotSupportedError, ProviderError, type ChannelAuth, type ConnectedAccount, type ContainerStatus, type HttpFetch, type OAuthFinish, type OAuthStart, type PlatformAdapter, type ProviderCallLog, type PublishInput, type ValidationIssue } from "./types";

// X API v2 with OAuth 2.0 Authorization Code + PKCE (confidential client). Every call is billed under X's
// pay-per-use API pricing — the UI shows a cost notice and nothing is sent without a configured developer app.
// Media: v2 upload endpoints (images one-shot, video chunked INIT/APPEND/FINALIZE + STATUS polling).
// Threads: caption parts separated by a "---" line are posted as replies to the previous post.
// Docs: https://docs.x.com/x-api/posts/creation-of-a-post , https://docs.x.com/x-api/media/media-upload

export const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"];
export const X_LIMITS = { textMax: 280, maxImages: 4, imageMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"], maxImageBytes: 5 * 1024 * 1024, maxVideoBytes: 512 * 1024 * 1024, maxVideoMs: 140_000, chunk: 4 * 1024 * 1024 } as const;

/** X counts every URL as 23 characters (t.co). */
export function xLength(text: string) {
  return [...text.replace(/https?:\/\/\S+/g, "x".repeat(23))].length;
}

export function validateX(input: PublishInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const parts = input.type === "thread" ? splitThread(input.caption) : [input.caption];
  if (input.type === "thread" && parts.length < 2) out.push({ field: "caption", code: "thread_parts", message: "Thread: Teile mit einer Zeile „---“ trennen" });
  parts.forEach((p, i) => {
    if (xLength(p) > X_LIMITS.textMax) out.push({ field: "caption", code: "caption_too_long", message: `Teil ${i + 1}: max. ${X_LIMITS.textMax} Zeichen` });
  });
  if (!["text", "image", "carousel", "video", "thread"].includes(input.type)) out.push({ field: "type", code: "type_unsupported", message: `X unterstützt ${input.type} nicht` });
  if (input.type === "text" && !input.caption.trim()) out.push({ field: "caption", code: "text_required", message: "Text erforderlich" });
  if (input.media.length > X_LIMITS.maxImages) out.push({ field: "media", code: "too_many_images", message: "Max. 4 Bilder" });
  for (const m of input.media.filter((x) => x.kind === "image")) if (!X_LIMITS.imageMimeTypes.includes(m.mimeType as never) || m.sizeBytes > X_LIMITS.maxImageBytes) out.push({ field: "media", code: "image_format", message: "JPEG/PNG/WebP/GIF, max. 5 MB" });
  const v = input.video;
  if (input.type === "video" && (!v || v.kind !== "video")) out.push({ field: "video", code: "video_required", message: "Video erforderlich" });
  if (v && v.durationMs !== undefined && v.durationMs > X_LIMITS.maxVideoMs) out.push({ field: "video", code: "video_duration", message: "Max. 2:20 min" });
  return out;
}

type Direct = { mediaIds?: string[] };

export class XAdapter implements PlatformAdapter {
  readonly platform = "x" as const;
  readonly isMock = false;
  readonly connectMode = "oauth_pkce" as const;
  private readonly http: HttpFetch;
  private readonly api = "https://api.x.com";

  constructor(private readonly opts: { clientId: string; clientSecret: string; fetch?: HttpFetch }) {
    this.http = opts.fetch ?? fetch;
  }

  getCapabilities() {
    return PLATFORM_CAPABILITIES.x;
  }
  validateContent(input: PublishInput) {
    return validateX(input);
  }

  buildAuthUrl({ state, redirectUri, codeChallenge }: OAuthStart) {
    if (!codeChallenge) throw new ProviderError("X requires PKCE", false, "PKCE_REQUIRED");
    const u = new URL("https://x.com/i/oauth2/authorize");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", this.opts.clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("scope", X_SCOPES.join(" "));
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", codeChallenge);
    u.searchParams.set("code_challenge_method", "S256");
    return u.toString();
  }

  private token(form: Record<string, string | undefined>) {
    return call<{ access_token: string; refresh_token?: string; expires_in: number; scope: string }>(this.http, "POST", `${this.api}/2/oauth2/token`, { headers: { authorization: basicAuth(this.opts.clientId, this.opts.clientSecret) }, form });
  }

  async exchangeCode({ code, redirectUri, codeVerifier }: OAuthFinish): Promise<ConnectedAccount[]> {
    const t = await this.token({ code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: codeVerifier });
    const me = await call<{ data: { id: string; name: string; username: string; profile_image_url?: string } }>(this.http, "GET", `${this.api}/2/users/me`, { query: { "user.fields": "profile_image_url" }, headers: { authorization: `Bearer ${t.access_token}` } });
    return [{ externalId: me.data.id, displayName: me.data.name, username: me.data.username, avatarUrl: me.data.profile_image_url, accessToken: t.access_token, refreshToken: t.refresh_token, tokenExpiresAt: expiresIn(t.expires_in), grantedScopes: t.scope.split(" "), meta: { username: me.data.username } }];
  }

  async refreshToken(auth: ChannelAuth) {
    if (!auth.refreshToken) throw new ProviderError("missing X refresh token", false, "REAUTH_REQUIRED");
    const t = await this.token({ grant_type: "refresh_token", refresh_token: auth.refreshToken });
    return { accessToken: t.access_token, expiresAt: expiresIn(t.expires_in), refreshToken: t.refresh_token }; // refresh tokens rotate
  }

  async disconnect(auth: ChannelAuth) {
    await call(this.http, "POST", `${this.api}/2/oauth2/revoke`, { headers: { authorization: basicAuth(this.opts.clientId, this.opts.clientSecret) }, form: { token: auth.refreshToken ?? auth.accessToken, token_type_hint: auth.refreshToken ? "refresh_token" : "access_token" } }).catch(() => {});
  }

  private bearer(auth: ChannelAuth) {
    return { authorization: `Bearer ${auth.accessToken}` };
  }

  private async uploadImage(auth: ChannelAuth, bytes: Uint8Array, mime: string, log: (l: ProviderCallLog) => void) {
    const fd = new FormData();
    fd.set("media", new Blob([bytes as BlobPart], { type: mime }));
    fd.set("media_category", "tweet_image");
    const r = await call<{ data: { id: string } }>(this.http, "POST", `${this.api}/2/media/upload`, { headers: this.bearer(auth), body: fd, step: "media.upload", log });
    return r.data.id;
  }

  private async uploadVideo(auth: ChannelAuth, bytes: Uint8Array, mime: string, log: (l: ProviderCallLog) => void) {
    const init = await call<{ data: { id: string } }>(this.http, "POST", `${this.api}/2/media/upload/initialize`, { headers: this.bearer(auth), json: { media_type: mime, total_bytes: bytes.byteLength, media_category: "tweet_video" }, step: "media.initialize", log });
    const id = init.data.id;
    for (let i = 0, seg = 0; i < bytes.byteLength; i += X_LIMITS.chunk, seg++) {
      const fd = new FormData();
      fd.set("media", new Blob([bytes.slice(i, i + X_LIMITS.chunk) as BlobPart], { type: "application/octet-stream" }));
      fd.set("segment_index", String(seg));
      await call(this.http, "POST", `${this.api}/2/media/upload/${id}/append`, { headers: this.bearer(auth), body: fd, step: "media.append", log });
    }
    await call(this.http, "POST", `${this.api}/2/media/upload/${id}/finalize`, { headers: this.bearer(auth), step: "media.finalize", log });
    return id;
  }

  async createMedia(auth: ChannelAuth, input: PublishInput, log: (l: ProviderCallLog) => void) {
    if (!["text", "image", "carousel", "video", "thread"].includes(input.type)) throw new CapabilityNotSupportedError(`post.${input.type}`);
    const mediaIds: string[] = [];
    for (const m of input.media.filter((x) => x.kind === "image")) mediaIds.push(await this.uploadImage(auth, await fetchMediaBytes(this.http, m, X_LIMITS.maxImageBytes), m.mimeType, log));
    const v = input.video ?? input.media.find((x) => x.kind === "video");
    if (v) mediaIds.push(await this.uploadVideo(auth, await fetchMediaBytes(this.http, v, X_LIMITS.maxVideoBytes), v.mimeType, log));
    return { containerId: directMarker({ mediaIds }) };
  }

  async getPublishStatus(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void): Promise<ContainerStatus> {
    const { mediaIds = [] } = parseDirect<Direct>(containerId);
    for (const id of mediaIds) {
      const s = await call<{ data?: { processing_info?: { state: string } } }>(this.http, "GET", `${this.api}/2/media/upload`, { query: { media_id: id, command: "STATUS" }, headers: this.bearer(auth), step: "media.status", log }).catch(() => ({ data: undefined }));
      const state = s.data?.processing_info?.state;
      if (state === "failed") return "error";
      if (state === "pending" || state === "in_progress") return "in_progress";
    }
    return "ready";
  }

  /** Exact tweet bodies (one per thread part). Exported for contract tests. */
  buildTweets(input: PublishInput, mediaIds: string[]) {
    const parts = input.type === "thread" ? splitThread(input.caption) : [input.caption];
    return parts.map((text, i) => ({ text, ...(i === 0 && mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }));
  }

  async publish(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void, input?: PublishInput) {
    if (!input) throw new ProviderError("direct publish needs input", false, "INTERNAL");
    const tweets = this.buildTweets(input, parseDirect<Direct>(containerId).mediaIds ?? []);
    let first: string | undefined;
    let prev: string | undefined;
    for (const [i, t] of tweets.entries()) {
      try {
        const r = await call<{ data: { id: string } }>(this.http, "POST", `${this.api}/2/tweets`, { headers: this.bearer(auth), json: { ...t, ...(prev ? { reply: { in_reply_to_tweet_id: prev } } : {}) }, step: `tweet.create.${i}`, log });
        prev = r.data.id;
        first ??= r.data.id;
      } catch (e) {
        // Part of a thread is live already: report it instead of failing (a retry would duplicate the first parts).
        if (first) {
          log({ step: "thread.partial", request: { part: i }, response: { error: (e as Error).message }, durationMs: 0 });
          break;
        }
        throw e;
      }
    }
    return { externalPostId: first! };
  }

  async getPostUrl(auth: ChannelAuth, id: string) {
    return `https://x.com/${String(auth.meta.username ?? "i")}/status/${id}`;
  }

  async fetchInsights(auth: ChannelAuth, id: string) {
    const r = await call<{ data?: { public_metrics?: { impression_count?: number; like_count?: number; reply_count?: number; retweet_count?: number; quote_count?: number } } }>(this.http, "GET", `${this.api}/2/tweets/${id}`, { query: { "tweet.fields": "public_metrics" }, headers: this.bearer(auth) });
    const m = r.data?.public_metrics;
    return { impressions: m?.impression_count ?? null, likes: m?.like_count ?? null, comments: m?.reply_count ?? null, shares: m ? (m.retweet_count ?? 0) + (m.quote_count ?? 0) : null };
  }

  async listComments(auth: ChannelAuth, id: string) {
    const r = await call<{ data?: { id: string; text: string; author_id: string; created_at: string }[] }>(this.http, "GET", `${this.api}/2/tweets/search/recent`, { query: { query: `conversation_id:${id}`, "tweet.fields": "author_id,created_at" }, headers: this.bearer(auth) });
    return (r.data ?? []).map((t) => ({ id: t.id, text: t.text, username: t.author_id, timestamp: t.created_at }));
  }

  async replyComment(auth: ChannelAuth, commentId: string, text: string) {
    const r = await call<{ data: { id: string } }>(this.http, "POST", `${this.api}/2/tweets`, { headers: this.bearer(auth), json: { text, reply: { in_reply_to_tweet_id: commentId } } });
    return { id: r.data.id };
  }

  async listMentions(auth: ChannelAuth) {
    const r = await call<{ data?: unknown[] }>(this.http, "GET", `${this.api}/2/users/${auth.externalId}/mentions`, { headers: this.bearer(auth) });
    return r.data ?? [];
  }
}
