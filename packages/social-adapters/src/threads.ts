import { PLATFORM_CAPABILITIES } from "./capabilities";
import { call, expiresIn, splitThread } from "./http";
import { CapabilityNotSupportedError, ProviderError, type ChannelAuth, type ConnectedAccount, type ContainerStatus, type HttpFetch, type OAuthFinish, type OAuthStart, type PlatformAdapter, type ProviderCallLog, type PublishInput, type ValidationIssue } from "./types";

// Threads API (graph.threads.net). Container model like Instagram: create container → wait FINISHED → threads_publish.
// Tokens: short-lived → long-lived (60 days) → refreshed with th_refresh_token. Media is pulled from our signed URLs.
// Thread chains: parts separated by "---" are published as replies (reply_to_id) after the first post.
// Docs: https://developers.facebook.com/docs/threads/posts

export const THREADS_SCOPES = ["threads_basic", "threads_content_publish", "threads_manage_replies", "threads_read_replies", "threads_manage_insights"];
export const TH_LIMITS = { textMax: 500, maxCarousel: 20, imageMimeTypes: ["image/jpeg", "image/png"], maxImageBytes: 8 * 1024 * 1024, maxVideoMs: 5 * 60_000 } as const;

export function validateThreads(input: PublishInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const parts = input.type === "thread" ? splitThread(input.caption) : [input.caption];
  parts.forEach((p, i) => {
    if ([...p].length > TH_LIMITS.textMax) out.push({ field: "caption", code: "caption_too_long", message: `Teil ${i + 1}: max. ${TH_LIMITS.textMax} Zeichen` });
  });
  if (!["text", "image", "carousel", "video", "thread"].includes(input.type)) out.push({ field: "type", code: "type_unsupported", message: `Threads unterstützt ${input.type} nicht` });
  if (input.type === "carousel" && (input.media.length < 2 || input.media.length > TH_LIMITS.maxCarousel)) out.push({ field: "media", code: "carousel_count", message: `Karussell: 2–${TH_LIMITS.maxCarousel} Elemente` });
  for (const m of input.media.filter((x) => x.kind === "image")) if (!TH_LIMITS.imageMimeTypes.includes(m.mimeType as never) || m.sizeBytes > TH_LIMITS.maxImageBytes) out.push({ field: "media", code: "image_format", message: "JPEG/PNG, max. 8 MB" });
  const v = input.video;
  if (v?.durationMs !== undefined && v.durationMs > TH_LIMITS.maxVideoMs) out.push({ field: "video", code: "video_duration", message: "Max. 5 Minuten" });
  return out;
}

export class ThreadsAdapter implements PlatformAdapter {
  readonly platform = "threads" as const;
  readonly isMock = false;
  readonly connectMode = "oauth" as const;
  private readonly http: HttpFetch;
  private readonly base = "https://graph.threads.net";

  constructor(private readonly opts: { appId: string; appSecret: string; fetch?: HttpFetch; sleep?: (ms: number) => Promise<void> }) {
    this.http = opts.fetch ?? fetch;
  }

  getCapabilities() {
    return PLATFORM_CAPABILITIES.threads;
  }
  validateContent(input: PublishInput) {
    return validateThreads(input);
  }

  buildAuthUrl({ state, redirectUri }: OAuthStart) {
    const u = new URL("https://threads.net/oauth/authorize");
    u.searchParams.set("client_id", this.opts.appId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("scope", THREADS_SCOPES.join(","));
    u.searchParams.set("response_type", "code");
    u.searchParams.set("state", state);
    return u.toString();
  }

  async exchangeCode({ code, redirectUri }: OAuthFinish): Promise<ConnectedAccount[]> {
    const short = await call<{ access_token: string; user_id: string | number }>(this.http, "POST", `${this.base}/oauth/access_token`, { form: { client_id: this.opts.appId, client_secret: this.opts.appSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code } });
    const long = await call<{ access_token: string; expires_in: number }>(this.http, "GET", `${this.base}/access_token`, { query: { grant_type: "th_exchange_token", client_secret: this.opts.appSecret, access_token: short.access_token } });
    const me = await call<{ id: string; username: string; threads_profile_picture_url?: string }>(this.http, "GET", `${this.base}/v1.0/me`, { query: { fields: "id,username,threads_profile_picture_url", access_token: long.access_token } });
    return [{ externalId: me.id, displayName: `@${me.username}`, username: me.username, avatarUrl: me.threads_profile_picture_url, accessToken: long.access_token, tokenExpiresAt: expiresIn(long.expires_in), grantedScopes: THREADS_SCOPES, meta: { username: me.username } }];
  }

  async refreshToken(auth: ChannelAuth) {
    const r = await call<{ access_token: string; expires_in: number }>(this.http, "GET", `${this.base}/refresh_access_token`, { query: { grant_type: "th_refresh_token", access_token: auth.accessToken } });
    return { accessToken: r.access_token, expiresAt: expiresIn(r.expires_in) };
  }

  async disconnect() {
    /* user removes the app in Threads settings; credentials deleted locally */
  }

  private async container(auth: ChannelAuth, params: Record<string, string | undefined>, log: (l: ProviderCallLog) => void) {
    const r = await call<{ id: string }>(this.http, "POST", `${this.base}/v1.0/${auth.externalId}/threads`, { query: { ...params, access_token: auth.accessToken }, step: "container.create", log });
    return r.id;
  }

  /** Container params for the first post. Exported for contract tests. */
  buildFirst(input: PublishInput): Record<string, string | undefined> {
    const text = input.type === "thread" ? splitThread(input.caption)[0] : input.caption;
    if (input.type === "image") return { media_type: "IMAGE", image_url: input.media[0]?.publicUrl, text };
    if (input.type === "video") return { media_type: "VIDEO", video_url: (input.video ?? input.media[0])?.publicUrl, text };
    return { media_type: "TEXT", text };
  }

  async createMedia(auth: ChannelAuth, input: PublishInput, log: (l: ProviderCallLog) => void) {
    if (!["text", "image", "carousel", "video", "thread"].includes(input.type)) throw new CapabilityNotSupportedError(`post.${input.type}`);
    if (input.type === "carousel") {
      const children: string[] = [];
      for (const m of input.media) children.push(await this.container(auth, { is_carousel_item: "true", media_type: m.kind === "video" ? "VIDEO" : "IMAGE", [m.kind === "video" ? "video_url" : "image_url"]: m.publicUrl }, log));
      return { containerId: await this.container(auth, { media_type: "CAROUSEL", children: children.join(","), text: input.caption }, log) };
    }
    return { containerId: await this.container(auth, this.buildFirst(input), log) };
  }

  async getPublishStatus(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void): Promise<ContainerStatus> {
    const r = await call<{ status: string; error_message?: string }>(this.http, "GET", `${this.base}/v1.0/${containerId}`, { query: { fields: "status,error_message", access_token: auth.accessToken }, step: "container.status", log });
    return ({ FINISHED: "ready", IN_PROGRESS: "in_progress", ERROR: "error", EXPIRED: "expired", PUBLISHED: "published" } as Record<string, ContainerStatus>)[r.status] ?? "in_progress";
  }

  async publish(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void, input?: PublishInput) {
    const r = await call<{ id: string }>(this.http, "POST", `${this.base}/v1.0/${auth.externalId}/threads_publish`, { query: { creation_id: containerId, access_token: auth.accessToken }, step: "publish", log });
    // Remaining thread parts: reply chain (best effort — the first post is live, so failures are logged, not retried).
    if (input?.type === "thread") {
      const sleep = this.opts.sleep ?? ((ms: number) => new Promise((res) => setTimeout(res, ms)));
      let prev = r.id;
      for (const text of splitThread(input.caption).slice(1)) {
        try {
          const c = await this.container(auth, { media_type: "TEXT", text, reply_to_id: prev }, log);
          for (let i = 0; i < 10 && (await this.getPublishStatus(auth, c, log)) === "in_progress"; i++) await sleep(2_000);
          prev = (await call<{ id: string }>(this.http, "POST", `${this.base}/v1.0/${auth.externalId}/threads_publish`, { query: { creation_id: c, access_token: auth.accessToken }, step: "publish.reply", log })).id;
        } catch (e) {
          log({ step: "thread.partial", request: {}, response: { error: (e as Error).message }, durationMs: 0 });
          break;
        }
      }
    }
    return { externalPostId: r.id };
  }

  async getPostUrl(auth: ChannelAuth, id: string) {
    const r = await call<{ permalink?: string }>(this.http, "GET", `${this.base}/v1.0/${id}`, { query: { fields: "permalink", access_token: auth.accessToken } });
    return r.permalink ?? null;
  }

  async fetchInsights(auth: ChannelAuth, id: string) {
    const r = await call<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(this.http, "GET", `${this.base}/v1.0/${id}/insights`, { query: { metric: "views,likes,replies,reposts,quotes,shares", access_token: auth.accessToken } });
    const get = (n: string) => {
      const m = r.data.find((x) => x.name === n);
      return m ? (m.total_value?.value ?? m.values?.[0]?.value ?? null) : null;
    };
    const reposts = get("reposts");
    const quotes = get("quotes");
    return { views: get("views"), likes: get("likes"), comments: get("replies"), shares: reposts === null && quotes === null ? null : (reposts ?? 0) + (quotes ?? 0) };
  }

  async listComments(auth: ChannelAuth, id: string) {
    const r = await call<{ data?: { id: string; text?: string; username?: string; timestamp: string }[] }>(this.http, "GET", `${this.base}/v1.0/${id}/replies`, { query: { fields: "id,text,username,timestamp", access_token: auth.accessToken } });
    return (r.data ?? []).map((c) => ({ id: c.id, text: c.text ?? "", username: c.username, timestamp: c.timestamp }));
  }

  async replyComment(auth: ChannelAuth, commentId: string, text: string) {
    const c = await this.container(auth, { media_type: "TEXT", text, reply_to_id: commentId }, () => {});
    const r = await call<{ id: string }>(this.http, "POST", `${this.base}/v1.0/${auth.externalId}/threads_publish`, { query: { creation_id: c, access_token: auth.accessToken } });
    if (!r.id) throw new ProviderError("reply not published", true, "REPLY_FAILED");
    return { id: r.id };
  }

  async listMentions() {
    return [];
  }
}
