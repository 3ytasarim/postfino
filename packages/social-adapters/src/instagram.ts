import { PLATFORM_CAPABILITIES } from "./capabilities";
import { validateInstagram } from "./instagram-validation";
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
} from "./types";

// Instagram on graph.facebook.com. Two set-ups:
//  • Instagram API with Unified Login (META_CONFIG_ID set) — Meta's recommended set-up and the only one offered to apps
//    created since late 2026. One Meta dialog lets the client continue with Instagram OR Facebook; no Facebook Page is
//    needed. The token is a business-integration system-user token scoped to the CLIENT's business portfolio (not the
//    person who logged in); "/me" is that system user. Accounts come from /me/assigned_instagram_accounts.
//    Docs: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login
//  • Legacy Instagram API with Facebook Login (no config): `scope` + Pages → instagram_business_account.
// Original note: Chosen because `cover_url` for REELS is
// documented in this flow's IG User Media reference; the Instagram-Login flow does not document it.
// Docs: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media

export const INSTAGRAM_FB_LOGIN_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
];

export type InstagramAdapterOptions = {
  appId: string;
  appSecret: string;
  graphVersion: string; // e.g. v27.0
  configId?: string; // Facebook Login for Business configuration id
  fetch?: HttpFetch;
  pollIntervalMs?: number;
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
};

const RETRYABLE_META_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 9007]);

export class InstagramAdapter implements PlatformAdapter {
  readonly platform = "instagram_business" as const;
  readonly isMock = false;
  private readonly http: HttpFetch;
  private readonly base: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: InstagramAdapterOptions) {
    this.http = opts.fetch ?? fetch;
    this.base = `https://graph.facebook.com/${opts.graphVersion}`;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  getCapabilities() {
    return PLATFORM_CAPABILITIES.instagram_business;
  }

  validateContent(input: PublishInput) {
    return validateInstagram(input);
  }

  buildAuthUrl({ state, redirectUri }: { state: string; redirectUri: string }) {
    const u = new URL(`https://www.facebook.com/${this.opts.graphVersion}/dialog/oauth`);
    u.searchParams.set("client_id", this.opts.appId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("response_type", "code");
    if (this.opts.configId) {
      // Unified Login: the configuration replaces `scope` (which must not be sent). prompt=login always shows both
      // "continue with Instagram" and "continue with Facebook" instead of silently reusing a Facebook session.
      u.searchParams.set("config_id", this.opts.configId);
      u.searchParams.set("prompt", "login");
    } else u.searchParams.set("scope", INSTAGRAM_FB_LOGIN_SCOPES.join(","));
    return u.toString();
  }

  async exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }): Promise<ConnectedAccount[]> {
    const short = await this.get<{ access_token: string }>("/oauth/access_token", {
      client_id: this.opts.appId,
      client_secret: this.opts.appSecret,
      redirect_uri: redirectUri,
      code,
    });
    if (this.opts.configId) return this.unifiedAccounts(short.access_token);
    // Long-lived user token (~60 d). Configurations that already issue a non-expiring token reject the exchange —
    // then the original token is kept (it does not expire, so nothing to refresh later).
    const long = await this.get<{ access_token: string; expires_in?: number }>("/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: this.opts.appId,
      client_secret: this.opts.appSecret,
      fb_exchange_token: short.access_token,
    }).catch(() => ({ access_token: short.access_token, expires_in: undefined as number | undefined }));
    const perms = await this.get<{ data: { permission: string; status: string }[] }>("/me/permissions", {
      access_token: long.access_token,
    }).catch(() => ({ data: [] as { permission: string; status: string }[] }));
    let granted = perms.data.filter((p) => p.status === "granted").map((p) => p.permission);
    const pages = await this.get<{
      data: { id: string; name: string; access_token: string; instagram_business_account?: { id: string } }[];
    }>("/me/accounts", { fields: "id,name,access_token,instagram_business_account", access_token: long.access_token }).catch(() => ({ data: [] as { id: string; name: string; access_token: string; instagram_business_account?: { id: string } }[] }));

    // Instagram accounts the user granted: via their Pages, and — for Facebook Login for Business — the assets chosen
    // in the dialog (debug_token → granular_scopes), which also covers accounts not reachable through /me/accounts.
    const targets: { igId: string; pageId?: string; pageName?: string }[] = pages.data.filter((p) => p.instagram_business_account?.id).map((p) => ({ igId: p.instagram_business_account!.id, pageId: p.id, pageName: p.name }));
    const dbg = await this.get<{ data?: { scopes?: string[]; granular_scopes?: { scope: string; target_ids?: string[] }[] } }>("/debug_token", {
      input_token: long.access_token,
      access_token: `${this.opts.appId}|${this.opts.appSecret}`,
    }).catch(() => ({ data: undefined }));
    if (!granted.length && dbg.data?.scopes) granted = dbg.data.scopes;
    for (const g of dbg.data?.granular_scopes ?? []) {
      if (g.scope !== "instagram_basic" && g.scope !== "instagram_content_publish") continue;
      for (const id of g.target_ids ?? []) if (!targets.some((t) => t.igId === id)) targets.push({ igId: id });
    }

    const accounts: ConnectedAccount[] = [];
    for (const { igId, pageId, pageName } of targets) {
      const ig = await this.get<{ id: string; username?: string; name?: string; profile_picture_url?: string }>(`/${igId}`, {
        fields: "id,username,name,profile_picture_url",
        access_token: long.access_token,
      });
      accounts.push({
        externalId: ig.id,
        displayName: ig.name ?? ig.username ?? ig.id,
        username: ig.username,
        avatarUrl: ig.profile_picture_url,
        // User token (long-lived ~60d) is what IG content publishing uses in the FB Login flow.
        accessToken: long.access_token,
        tokenExpiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : undefined,
        grantedScopes: granted,
        meta: { pageId, pageName, loginFlow: this.opts.configId ? "facebook_login_for_business" : "facebook_login" },
      });
    }
    if (!accounts.length)
      // Diagnostics for the operator (no token values): which Pages came back and whether any has an IG professional account.
      console.warn("[instagram facebook login] no Instagram account", JSON.stringify({ granted, pages: pages.data.map((p) => ({ name: p.name, hasInstagram: Boolean(p.instagram_business_account?.id) })), granularIg: (dbg.data?.granular_scopes ?? []).filter((g) => g.scope.startsWith("instagram_") || g.scope.startsWith("pages_")) }));
    return accounts;
  }

  /** Unified Login: one system-user token covers every IG account the client shared from their business portfolio. */
  private async unifiedAccounts(token: string): Promise<ConnectedAccount[]> {
    const me = await this.get<{ id: string; client_business_id?: string }>("/me", { fields: "id,client_business_id", access_token: token }).catch(() => ({ id: "", client_business_id: undefined }));
    const listed: { id: string; username?: string }[] = [];
    let page = await this.get<{ data: { id: string; username?: string }[]; paging?: { cursors?: { after?: string }; next?: string } }>("/me/assigned_instagram_accounts", { fields: "id,username", limit: "50", access_token: token });
    listed.push(...page.data);
    for (let i = 0; i < 10 && page.paging?.next && page.paging.cursors?.after; i++) {
      page = await this.get("/me/assigned_instagram_accounts", { fields: "id,username", limit: "50", after: page.paging.cursors.after, access_token: token });
      listed.push(...page.data);
    }
    const dbg = await this.get<{ data?: { scopes?: string[]; expires_at?: number; type?: string; granular_scopes?: { scope: string; target_ids?: string[] }[] } }>("/debug_token", { input_token: token, access_token: `${this.opts.appId}|${this.opts.appSecret}` }).catch(() => ({ data: undefined }));
    if (!listed.length) {
      // Fallbacks: the assets chosen in the dialog (granular scopes) and the client portfolio's Instagram accounts.
      for (const g of dbg.data?.granular_scopes ?? [])
        if (g.scope.startsWith("instagram_")) for (const id of g.target_ids ?? []) if (!listed.some((x) => x.id === id)) listed.push({ id });
      if (!listed.length && me.client_business_id)
        for (const edge of ["instagram_accounts", "owned_instagram_accounts"]) {
          const r = await this.get<{ data: { id: string; username?: string }[] }>(`/${me.client_business_id}/${edge}`, { fields: "id,username", access_token: token }).catch(() => ({ data: [] as { id: string; username?: string }[] }));
          for (const x of r.data) if (!listed.some((y) => y.id === x.id)) listed.push(x);
          if (listed.length) break;
        }
    }
    if (!listed.length) {
      // Diagnostics for the operator (no token values): what Meta actually granted for this login.
      console.warn("[instagram unified login] no Instagram account", JSON.stringify({ tokenType: dbg.data?.type, scopes: dbg.data?.scopes, granular: dbg.data?.granular_scopes, clientBusinessId: me.client_business_id ?? null, systemUser: Boolean(me.id) }));
      // Most common cause (developer reports): the configuration lacks business_management, so the asset grant is dropped.
      throw new ProviderError("Meta returned no Instagram account for this login. Check that the login configuration includes business_management and that an Instagram professional account was selected in the dialog.", false, "NO_INSTAGRAM_ASSETS");
    }
    const expiresAt = dbg.data?.expires_at ? new Date(dbg.data.expires_at * 1000) : undefined; // 0 / missing = never
    const accounts: ConnectedAccount[] = [];
    for (const a of listed) {
      const ig = await this.get<{ id: string; username?: string; name?: string; profile_picture_url?: string }>(`/${a.id}`, { fields: "id,username,name,profile_picture_url", access_token: token }).catch(() => ({ id: a.id, username: a.username, name: undefined, profile_picture_url: undefined }));
      accounts.push({
        externalId: ig.id,
        displayName: ig.name ?? ig.username ?? a.username ?? ig.id,
        username: ig.username ?? a.username,
        avatarUrl: ig.profile_picture_url,
        accessToken: token,
        tokenExpiresAt: expiresAt,
        grantedScopes: dbg.data?.scopes ?? [],
        meta: { loginFlow: "unified_login", clientBusinessId: me.client_business_id, systemUserId: me.id || undefined },
      });
    }
    return accounts;
  }

  async refreshToken(auth: ChannelAuth) {
    // (non-expiring tokens are never selected for refresh: core/token-refresh only picks credentials with an expiry)
    const r = await this.get<{ access_token: string; expires_in?: number }>("/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: this.opts.appId,
      client_secret: this.opts.appSecret,
      fb_exchange_token: auth.accessToken,
    });
    return { accessToken: r.access_token, expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000) : undefined };
  }

  async disconnect(auth: ChannelAuth) {
    // Revokes all permissions granted by this user to the app (user-level; affects every IG account of this login).
    await this.request("DELETE", "/me/permissions", { access_token: auth.accessToken });
  }

  /** Builds the exact container parameters (single media: reel, image, story). Exported for the PoC dry-run and contract tests. */
  buildContainerParams(input: PublishInput): Record<string, string> {
    const url = (m: { publicUrl?: string } | undefined, what: string) => {
      if (!m?.publicUrl) throw new ProviderError(`${what} has no public URL for Meta to fetch`, false, "MEDIA_URL_MISSING");
      return m.publicUrl;
    };
    if (input.type === "image") {
      const p: Record<string, string> = { image_url: url(input.media[0], "image"), caption: input.caption };
      if (input.options.locationId) p.location_id = input.options.locationId;
      if (input.options.collaborators?.length) p.collaborators = JSON.stringify(input.options.collaborators);
      return p;
    }
    if (input.type === "story") {
      const m = input.video ?? input.media[0];
      return m?.kind === "video" ? { media_type: "STORIES", video_url: url(m, "story video") } : { media_type: "STORIES", image_url: url(m, "story image") };
    }
    if (input.type !== "reel") throw new CapabilityNotSupportedError(`instagram:${input.type}`);
    if (!input.video?.publicUrl) throw new ProviderError("video has no public URL for Meta to fetch", false, "MEDIA_URL_MISSING");
    const p: Record<string, string> = {
      media_type: "REELS",
      video_url: input.video.publicUrl,
      caption: input.caption,
      share_to_feed: String(input.options.shareToFeed ?? true),
    };
    if (input.cover) {
      if (!input.cover.publicUrl) throw new ProviderError("cover has no public URL for Meta to fetch", false, "MEDIA_URL_MISSING");
      p.cover_url = input.cover.publicUrl;
    } else if (input.thumbOffsetMs !== undefined) {
      p.thumb_offset = String(input.thumbOffsetMs);
    }
    if (input.options.collaborators?.length) p.collaborators = JSON.stringify(input.options.collaborators);
    if (input.options.locationId) p.location_id = input.options.locationId;
    if (input.options.trial) p.trial_params = JSON.stringify({ graduation_strategy: input.options.trial });
    return p;
  }

  async createMedia(auth: ChannelAuth, input: PublishInput, log: (l: ProviderCallLog) => void) {
    if (input.type === "carousel") return this.createCarousel(auth, input, log);
    const params = this.buildContainerParams(input);
    const r = await this.request<{ id: string }>("POST", `/${auth.externalId}/media`, { ...params, access_token: auth.accessToken }, log, "create_container");
    return { containerId: r.id };
  }

  /** Carousel: create item containers (is_carousel_item), wait for video items, then the parent container. */
  private async createCarousel(auth: ChannelAuth, input: PublishInput, log: (l: ProviderCallLog) => void) {
    const children: string[] = [];
    for (const [i, m] of input.media.entries()) {
      if (!m.publicUrl) throw new ProviderError(`carousel item ${i + 1} has no public URL`, false, "MEDIA_URL_MISSING");
      const p: Record<string, string> = m.kind === "video" ? { media_type: "VIDEO", video_url: m.publicUrl, is_carousel_item: "true" } : { image_url: m.publicUrl, is_carousel_item: "true" };
      const r = await this.request<{ id: string }>("POST", `/${auth.externalId}/media`, { ...p, access_token: auth.accessToken }, log, `create_item_${i + 1}`);
      if (m.kind === "video") {
        let st = await this.getPublishStatus(auth, r.id, log);
        for (let k = 0; st === "in_progress" && k < (this.opts.maxPolls ?? 60); k++) {
          await this.sleep(this.opts.pollIntervalMs ?? 5000);
          st = await this.getPublishStatus(auth, r.id, log);
        }
        if (st !== "ready") throw new ProviderError(`carousel video item ${i + 1}: ${st}`, st === "in_progress", "CAROUSEL_ITEM_NOT_READY");
      }
      children.push(r.id);
    }
    const parent: Record<string, string> = { media_type: "CAROUSEL", children: children.join(","), caption: input.caption };
    if (input.options.locationId) parent.location_id = input.options.locationId;
    if (input.options.collaborators?.length) parent.collaborators = JSON.stringify(input.options.collaborators);
    const r = await this.request<{ id: string }>("POST", `/${auth.externalId}/media`, { ...parent, access_token: auth.accessToken }, log, "create_container");
    return { containerId: r.id };
  }

  /** First comment on the published media (instagram_manage_comments). */
  async postFirstComment(auth: ChannelAuth, externalPostId: string, text: string, log: (l: ProviderCallLog) => void) {
    const r = await this.request<{ id: string }>("POST", `/${externalPostId}/comments`, { message: text, access_token: auth.accessToken }, log, "first_comment");
    return { id: r.id };
  }

  async getPublishStatus(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void): Promise<ContainerStatus> {
    const r = await this.request<{ status_code?: string; status?: string }>(
      "GET",
      `/${containerId}`,
      { fields: "status_code,status", access_token: auth.accessToken },
      log,
      "poll",
    );
    switch (r.status_code) {
      case "FINISHED":
        return "ready";
      case "PUBLISHED":
        return "published";
      case "EXPIRED":
        return "expired";
      case "ERROR":
        return "error";
      default:
        return "in_progress";
    }
  }

  async publish(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void) {
    const r = await this.request<{ id: string }>(
      "POST",
      `/${auth.externalId}/media_publish`,
      { creation_id: containerId, access_token: auth.accessToken },
      log,
      "publish",
    );
    return { externalPostId: r.id };
  }

  async getPostUrl(auth: ChannelAuth, externalPostId: string) {
    const r = await this.get<{ permalink?: string }>(`/${externalPostId}`, { fields: "permalink", access_token: auth.accessToken });
    return r.permalink ?? null;
  }

  async getPublishingLimit(auth: ChannelAuth) {
    return this.get<{ data: { quota_usage: number; config?: { quota_total: number; quota_duration: number } }[] }>(
      `/${auth.externalId}/content_publishing_limit`,
      { fields: "quota_usage,config", access_token: auth.accessToken },
    );
  }

  /** Media metrics: fields (likes/comments) + insights. Metrics the API rejects for this media type stay null. */
  async fetchInsights(auth: ChannelAuth, externalPostId: string): Promise<Record<string, number | null>> {
    const out: Record<string, number | null> = { likes: null, comments: null, reach: null, views: null, saves: null, shares: null, interactions: null };
    const f = await this.get<{ like_count?: number; comments_count?: number; media_product_type?: string }>(`/${externalPostId}`, { fields: "like_count,comments_count,media_product_type", access_token: auth.accessToken });
    out.likes = f.like_count ?? null; // null when the owner hid like counts
    out.comments = f.comments_count ?? null;
    const wanted = ["reach", "views", "saved", "shares", "total_interactions"];
    const map: Record<string, string> = { reach: "reach", views: "views", saved: "saves", shares: "shares", total_interactions: "interactions" };
    for (const metric of wanted) {
      try {
        const r = await this.get<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(`/${externalPostId}/insights`, { metric, access_token: auth.accessToken });
        const d = r.data[0];
        out[map[metric]!] = d?.total_value?.value ?? d?.values?.[0]?.value ?? null;
      } catch (e) {
        if (e instanceof ProviderError && e.retryable) throw e; // unsupported metric → stays null; rate limits bubble up
      }
    }
    return out;
  }

  async fetchAccountInsights(auth: ChannelAuth): Promise<Record<string, number | null>> {
    const out: Record<string, number | null> = { followers: null, media_count: null, profile_views: null, reach: null };
    const f = await this.get<{ followers_count?: number; media_count?: number }>(`/${auth.externalId}`, { fields: "followers_count,media_count", access_token: auth.accessToken });
    out.followers = f.followers_count ?? null;
    out.media_count = f.media_count ?? null;
    for (const metric of ["profile_views", "reach"]) {
      try {
        const r = await this.get<{ data: { total_value?: { value: number }; values?: { value: number }[] }[] }>(`/${auth.externalId}/insights`, { metric, period: "day", metric_type: "total_value", access_token: auth.accessToken });
        out[metric] = r.data[0]?.total_value?.value ?? r.data[0]?.values?.at(-1)?.value ?? null;
      } catch (e) {
        if (e instanceof ProviderError && e.retryable) throw e;
      }
    }
    return out;
  }

  async listComments(auth: ChannelAuth, externalPostId: string) {
    type C = { id: string; text: string; username?: string; timestamp: string; replies?: { data: C[] } };
    const r = await this.get<{ data: C[] }>(`/${externalPostId}/comments`, { fields: "id,text,username,timestamp,replies{id,text,username,timestamp}", limit: "50", access_token: auth.accessToken });
    return r.data.flatMap((c) => [
      { id: c.id, text: c.text, username: c.username, timestamp: c.timestamp },
      ...(c.replies?.data ?? []).map((x) => ({ id: x.id, text: x.text, username: x.username, timestamp: x.timestamp, parentId: c.id })),
    ]);
  }

  async replyComment(auth: ChannelAuth, commentId: string, text: string) {
    const r = await this.request<{ id: string }>("POST", `/${commentId}/replies`, { message: text, access_token: auth.accessToken });
    return { id: r.id };
  }
  async listMentions(): Promise<never> {
    throw new CapabilityNotSupportedError("instagram:mentions");
  }

  // ── HTTP ──
  private get<T>(path: string, query: Record<string, string>) {
    return this.request<T>("GET", path, query);
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params: Record<string, string>,
    log?: (l: ProviderCallLog) => void,
    step = "request",
  ): Promise<T> {
    const url = new URL(this.base + path);
    let body: URLSearchParams | undefined;
    if (method === "POST") body = new URLSearchParams(params);
    else for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const started = Date.now();
    let res: Response;
    try {
      res = await this.http(url, { method, body, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new ProviderError(`network error: ${(e as Error).message}`, true, "NETWORK");
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    log?.({ step, request: { method, path, params: redact(params) }, response: { status: res.status, body: json }, durationMs: Date.now() - started });
    if (!res.ok || json.error) {
      const err = (json.error ?? {}) as { message?: string; code?: number; error_subcode?: number; is_transient?: boolean };
      const retryable = res.status >= 500 || res.status === 429 || Boolean(err.is_transient) || RETRYABLE_META_CODES.has(err.code ?? -1);
      throw new ProviderError(err.message ?? `HTTP ${res.status}`, retryable, `META_${err.code ?? res.status}${err.error_subcode ? `_${err.error_subcode}` : ""}`, json);
    }
    return json as T;
  }
}

function redact(p: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) out[k] = /token|secret|code$/.test(k) ? "[redacted]" : v;
  return out;
}
