import { PLATFORM_CAPABILITIES } from "./capabilities";
import {
  CapabilityNotSupportedError,
  ProviderError,
  type ChannelAuth,
  type ConnectedAccount,
  type ContainerStatus,
  type HttpFetch,
  type PlatformAdapter,
  type ProviderCallLog,
  type PublishInput,
  type ValidationIssue,
} from "./types";

// Facebook Pages via Graph API (Pages API). Publishing is a single call (no container), so createMedia
// returns a "direct:" marker and publish() performs the call with the input. The publisher never retries
// a direct publish whose outcome is unknown (network failure after sending) — see publisher.ts.
// Docs: https://developers.facebook.com/docs/pages-api/posts

export const FACEBOOK_PAGE_SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "business_management"];
export const FB_LIMITS = { textMax: 63206, imageMimeTypes: ["image/jpeg", "image/png"], maxImageBytes: 10 * 1024 * 1024, videoMimeTypes: ["video/mp4", "video/quicktime"], maxVideoBytes: 1024 * 1024 * 1024 } as const;
const RETRYABLE_META_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613]);

export function validateFacebook(input: PublishInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (input.caption.length > FB_LIMITS.textMax) out.push({ field: "caption", code: "caption_too_long", message: `Max. ${FB_LIMITS.textMax} Zeichen` });
  if (input.type === "text" && !input.caption.trim()) out.push({ field: "caption", code: "text_required", message: "Text erforderlich" });
  if (input.type === "image") {
    const m = input.media[0];
    if (!m) out.push({ field: "media", code: "media_required", message: "Bild erforderlich" });
    else {
      if (!FB_LIMITS.imageMimeTypes.includes(m.mimeType as never)) out.push({ field: "media", code: "image_format", message: "JPEG oder PNG" });
      if (m.sizeBytes > FB_LIMITS.maxImageBytes) out.push({ field: "media", code: "image_too_large", message: "Max. 10 MB" });
    }
  }
  if (input.type === "video") {
    const v = input.video ?? input.media[0];
    if (!v || v.kind !== "video") out.push({ field: "video", code: "video_required", message: "Video erforderlich" });
    else if (!FB_LIMITS.videoMimeTypes.includes(v.mimeType as never)) out.push({ field: "video", code: "video_format", message: "MP4 oder MOV" });
  }
  return out;
}

export class FacebookPageAdapter implements PlatformAdapter {
  readonly platform = "facebook_page" as const;
  readonly isMock = false;
  private readonly http: HttpFetch;
  private readonly base: string;

  constructor(private readonly opts: { appId: string; appSecret: string; graphVersion: string; configId?: string; fetch?: HttpFetch }) {
    this.http = opts.fetch ?? fetch;
    this.base = `https://graph.facebook.com/${opts.graphVersion}`;
  }

  getCapabilities() {
    return PLATFORM_CAPABILITIES.facebook_page;
  }
  validateContent(input: PublishInput) {
    return validateFacebook(input);
  }

  buildAuthUrl({ state, redirectUri }: { state: string; redirectUri: string }) {
    const u = new URL(`https://www.facebook.com/${this.opts.graphVersion}/dialog/oauth`);
    u.searchParams.set("client_id", this.opts.appId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("response_type", "code");
    if (this.opts.configId) {
      u.searchParams.set("config_id", this.opts.configId);
      u.searchParams.set("override_default_response_type", "true"); // Facebook Login for Business code flow
    }
    else u.searchParams.set("scope", FACEBOOK_PAGE_SCOPES.join(","));
    return u.toString();
  }

  async exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }): Promise<ConnectedAccount[]> {
    const short = await this.request<{ access_token: string }>("GET", "/oauth/access_token", { client_id: this.opts.appId, client_secret: this.opts.appSecret, redirect_uri: redirectUri, code });
    const long = await this.request<{ access_token: string }>("GET", "/oauth/access_token", { grant_type: "fb_exchange_token", client_id: this.opts.appId, client_secret: this.opts.appSecret, fb_exchange_token: short.access_token });
    const perms = await this.request<{ data: { permission: string; status: string }[] }>("GET", "/me/permissions", { access_token: long.access_token });
    const granted = perms.data.filter((p) => p.status === "granted").map((p) => p.permission);
    // Page tokens derived from a long-lived user token do not expire (until revoked / password change).
    const pages = await this.request<{ data: { id: string; name: string; access_token: string; tasks?: string[]; picture?: { data?: { url?: string } } }[] }>("GET", "/me/accounts", {
      fields: "id,name,access_token,tasks,picture",
      access_token: long.access_token,
    });
    return pages.data
      .filter((p) => !p.tasks || p.tasks.includes("CREATE_CONTENT") || p.tasks.includes("MANAGE"))
      .map((p) => ({
        externalId: p.id,
        displayName: p.name,
        avatarUrl: p.picture?.data?.url,
        accessToken: p.access_token,
        grantedScopes: granted,
        meta: { tasks: p.tasks ?? [], loginFlow: "facebook_login" },
      }));
  }

  async refreshToken(auth: ChannelAuth) {
    // Page tokens are non-expiring; verify they still work instead of exchanging.
    await this.request("GET", `/${auth.externalId}`, { fields: "id", access_token: auth.accessToken });
    return { accessToken: auth.accessToken };
  }

  async disconnect() {
    /* Page tokens are revoked locally; the user removes the app in Facebook settings. */
  }

  /** Exact Graph call for a post. Exported for contract tests. */
  buildPublishCall(pageId: string, input: PublishInput): { path: string; params: Record<string, string> } {
    const need = (m: { publicUrl?: string } | undefined, what: string) => {
      if (!m?.publicUrl) throw new ProviderError(`${what} has no public URL for Meta to fetch`, false, "MEDIA_URL_MISSING");
      return m.publicUrl;
    };
    switch (input.type) {
      case "text": {
        const link = /https?:\/\/\S+/.exec(input.caption)?.[0];
        return { path: `/${pageId}/feed`, params: { message: input.caption, ...(link ? { link } : {}) } };
      }
      case "image":
        return { path: `/${pageId}/photos`, params: { url: need(input.media[0], "image"), caption: input.caption, published: "true" } };
      case "video":
        return { path: `/${pageId}/videos`, params: { file_url: need(input.video ?? input.media[0], "video"), description: input.caption } };
      default:
        throw new CapabilityNotSupportedError(`facebook_page:${input.type}`);
    }
  }

  async createMedia(auth: ChannelAuth, input: PublishInput) {
    this.buildPublishCall(auth.externalId, input); // validate before marking
    return { containerId: `direct:${crypto.randomUUID()}` };
  }

  async getPublishStatus(_auth: ChannelAuth, containerId: string): Promise<ContainerStatus> {
    return containerId.startsWith("direct:") ? "ready" : "error";
  }

  async publish(auth: ChannelAuth, _containerId: string, log: (l: ProviderCallLog) => void, input?: PublishInput) {
    if (!input) throw new ProviderError("facebook direct publish requires input", false, "INTERNAL");
    const call = this.buildPublishCall(auth.externalId, input);
    const r = await this.request<{ id: string; post_id?: string }>("POST", call.path, { ...call.params, access_token: auth.accessToken }, log, "publish");
    return { externalPostId: r.post_id ?? r.id };
  }

  async postFirstComment(auth: ChannelAuth, externalPostId: string, text: string, log: (l: ProviderCallLog) => void) {
    const r = await this.request<{ id: string }>("POST", `/${externalPostId}/comments`, { message: text, access_token: auth.accessToken }, log, "first_comment");
    return { id: r.id };
  }

  async getPostUrl(auth: ChannelAuth, externalPostId: string) {
    const r = await this.request<{ permalink_url?: string }>("GET", `/${externalPostId}`, { fields: "permalink_url", access_token: auth.accessToken });
    return r.permalink_url ?? null;
  }

  /** Post engagement from post fields. Reach / views are not reliably available for page posts → null. */
  async fetchInsights(auth: ChannelAuth, externalPostId: string): Promise<Record<string, number | null>> {
    const r = await this.request<{ reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } }; shares?: { count?: number } }>("GET", `/${externalPostId}`, {
      fields: "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares",
      access_token: auth.accessToken,
    });
    return { likes: r.reactions?.summary?.total_count ?? null, comments: r.comments?.summary?.total_count ?? null, shares: r.shares?.count ?? 0, reach: null, views: null, saves: null, interactions: null };
  }

  async fetchAccountInsights(auth: ChannelAuth): Promise<Record<string, number | null>> {
    const r = await this.request<{ followers_count?: number; fan_count?: number }>("GET", `/${auth.externalId}`, { fields: "followers_count,fan_count", access_token: auth.accessToken });
    return { followers: r.followers_count ?? r.fan_count ?? null, media_count: null, profile_views: null, reach: null };
  }

  async listComments(auth: ChannelAuth, externalPostId: string) {
    type C = { id: string; message?: string; from?: { name?: string }; created_time: string; comments?: { data: C[] } };
    const r = await this.request<{ data: C[] }>("GET", `/${externalPostId}/comments`, { fields: "id,message,from{name},created_time,comments{id,message,from{name},created_time}", limit: "50", access_token: auth.accessToken });
    return r.data.flatMap((c) => [
      { id: c.id, text: c.message ?? "", username: c.from?.name, timestamp: c.created_time },
      ...(c.comments?.data ?? []).map((x) => ({ id: x.id, text: x.message ?? "", username: x.from?.name, timestamp: x.created_time, parentId: c.id })),
    ]);
  }

  async replyComment(auth: ChannelAuth, commentId: string, text: string) {
    const r = await this.request<{ id: string }>("POST", `/${commentId}/comments`, { message: text, access_token: auth.accessToken });
    return { id: r.id };
  }
  async listMentions(): Promise<never> {
    throw new CapabilityNotSupportedError("facebook_page:mentions");
  }

  private async request<T>(method: "GET" | "POST", path: string, params: Record<string, string>, log?: (l: ProviderCallLog) => void, step = "request"): Promise<T> {
    const url = new URL(this.base + path);
    let body: URLSearchParams | undefined;
    if (method === "POST") body = new URLSearchParams(params);
    else for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const started = Date.now();
    let res: Response;
    try {
      res = await this.http(url, { method, body, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      throw new ProviderError(`network error: ${(e as Error).message}`, true, "NETWORK");
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const redacted = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, /token|secret|code$/.test(k) ? "[redacted]" : v]));
    log?.({ step, request: { method, path, params: redacted }, response: { status: res.status, body: json }, durationMs: Date.now() - started });
    if (!res.ok || json.error) {
      const err = (json.error ?? {}) as { message?: string; code?: number; error_subcode?: number; is_transient?: boolean };
      const retryable = res.status >= 500 || res.status === 429 || Boolean(err.is_transient) || RETRYABLE_META_CODES.has(err.code ?? -1);
      throw new ProviderError(err.message ?? `HTTP ${res.status}`, retryable, `META_${err.code ?? res.status}${err.error_subcode ? `_${err.error_subcode}` : ""}`, json);
    }
    return json as T;
  }
}
