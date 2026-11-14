import { PLATFORM_CAPABILITIES } from "./capabilities";
import { basicAuth, call, directMarker, expiresIn, fetchMediaBytes, firstLine, parseDirect } from "./http";
import { CapabilityNotSupportedError, ProviderError, type ChannelAuth, type ConnectedAccount, type ContainerStatus, type HttpFetch, type OAuthFinish, type OAuthStart, type PlatformAdapter, type ProviderCallLog, type PublishInput, type ValidationIssue } from "./types";

// Pinterest API v5. Each board is connected as its own channel (externalId = board id).
// Image pins are pulled from our signed URL; video pins are uploaded (register media → S3 form upload →
// poll status) and REQUIRE a cover image — the independent cover is native here.
// Apps with "Trial access" may only write to the sandbox host; set PINTEREST_API_BASE accordingly.
// Docs: https://developers.pinterest.com/docs/api/v5/

export const PINTEREST_SCOPES = ["boards:read", "pins:read", "pins:write", "user_accounts:read"];
export const PIN_LIMITS = { titleMax: 100, descriptionMax: 500, imageMimeTypes: ["image/jpeg", "image/png", "image/webp"], maxImageBytes: 20 * 1024 * 1024, maxVideoBytes: 2 * 1024 ** 3, minVideoMs: 4_000, maxVideoMs: 15 * 60_000 } as const;

export function validatePinterest(input: PublishInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!["image", "video", "carousel"].includes(input.type)) out.push({ field: "type", code: "type_unsupported", message: "Pinterest: Bild, Video oder Karussell" });
  if (input.caption.length > PIN_LIMITS.descriptionMax) out.push({ field: "caption", code: "caption_too_long", message: `Beschreibung max. ${PIN_LIMITS.descriptionMax} Zeichen` });
  if ((input.options.title ?? "").length > PIN_LIMITS.titleMax) out.push({ field: "title", code: "title_too_long", message: `Titel max. ${PIN_LIMITS.titleMax} Zeichen` });
  if (input.options.link && !/^https?:\/\//.test(input.options.link)) out.push({ field: "link", code: "link_invalid", message: "Link muss mit https:// beginnen" });
  if (input.type === "image" || input.type === "carousel") {
    if (input.media.length === 0) out.push({ field: "media", code: "media_required", message: "Bild erforderlich" });
    if (input.type === "carousel" && (input.media.length < 2 || input.media.length > 5)) out.push({ field: "media", code: "carousel_count", message: "Karussell: 2–5 Bilder" });
    for (const m of input.media) if (!PIN_LIMITS.imageMimeTypes.includes(m.mimeType as never) || m.sizeBytes > PIN_LIMITS.maxImageBytes) out.push({ field: "media", code: "image_format", message: "JPEG/PNG/WebP, max. 20 MB" });
  }
  if (input.type === "video") {
    const v = input.video ?? input.media[0];
    if (!v || v.kind !== "video") out.push({ field: "video", code: "video_required", message: "Video erforderlich" });
    else if (v.durationMs !== undefined && (v.durationMs < PIN_LIMITS.minVideoMs || v.durationMs > PIN_LIMITS.maxVideoMs)) out.push({ field: "video", code: "video_duration", message: "4 s bis 15 min" });
    if (!input.cover) out.push({ field: "cover", code: "cover_required", message: "Video-Pins brauchen ein Coverbild" });
  }
  return out;
}

type Direct = { mediaId?: string };

export class PinterestAdapter implements PlatformAdapter {
  readonly platform = "pinterest" as const;
  readonly isMock = false;
  readonly connectMode = "oauth" as const;
  private readonly http: HttpFetch;
  private readonly api: string;

  constructor(private readonly opts: { appId: string; appSecret: string; apiBase?: string; fetch?: HttpFetch }) {
    this.http = opts.fetch ?? fetch;
    this.api = (opts.apiBase ?? "https://api.pinterest.com").replace(/\/$/, "");
  }

  getCapabilities() {
    return PLATFORM_CAPABILITIES.pinterest;
  }
  validateContent(input: PublishInput) {
    return validatePinterest(input);
  }

  buildAuthUrl({ state, redirectUri }: OAuthStart) {
    const u = new URL("https://www.pinterest.com/oauth/");
    u.searchParams.set("client_id", this.opts.appId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", PINTEREST_SCOPES.join(","));
    u.searchParams.set("state", state);
    return u.toString();
  }

  private token(form: Record<string, string>) {
    return call<{ access_token: string; refresh_token?: string; expires_in: number; scope: string }>(this.http, "POST", `${this.api}/v5/oauth/token`, { headers: { authorization: basicAuth(this.opts.appId, this.opts.appSecret) }, form });
  }

  async exchangeCode({ code, redirectUri }: OAuthFinish): Promise<ConnectedAccount[]> {
    const t = await this.token({ grant_type: "authorization_code", code, redirect_uri: redirectUri, continuous_refresh: "true" });
    const h = { authorization: `Bearer ${t.access_token}` };
    const user = await call<{ username: string; profile_image?: string }>(this.http, "GET", `${this.api}/v5/user_account`, { headers: h });
    const boards = await call<{ items: { id: string; name: string; privacy?: string }[] }>(this.http, "GET", `${this.api}/v5/boards`, { query: { page_size: 100 }, headers: h });
    return boards.items.map((b) => ({ externalId: b.id, displayName: `${user.username} / ${b.name}`, username: user.username, avatarUrl: user.profile_image, accessToken: t.access_token, refreshToken: t.refresh_token, tokenExpiresAt: expiresIn(t.expires_in), grantedScopes: t.scope.split(/[ ,]+/), meta: { boardName: b.name, privacy: b.privacy ?? null } }));
  }

  async refreshToken(auth: ChannelAuth) {
    if (!auth.refreshToken) throw new ProviderError("missing Pinterest refresh token", false, "REAUTH_REQUIRED");
    const t = await this.token({ grant_type: "refresh_token", refresh_token: auth.refreshToken });
    return { accessToken: t.access_token, expiresAt: expiresIn(t.expires_in), refreshToken: t.refresh_token };
  }

  async disconnect() {
    /* no revoke endpoint; user removes the app in Pinterest settings */
  }

  private bearer(auth: ChannelAuth) {
    return { authorization: `Bearer ${auth.accessToken}` };
  }

  async createMedia(auth: ChannelAuth, input: PublishInput, log: (l: ProviderCallLog) => void) {
    if (input.type === "image" || input.type === "carousel") return { containerId: directMarker() };
    if (input.type !== "video") throw new CapabilityNotSupportedError(`post.${input.type}`);
    const v = input.video ?? input.media[0]!;
    const reg = await call<{ media_id: string; upload_url: string; upload_parameters: Record<string, string> }>(this.http, "POST", `${this.api}/v5/media`, { headers: this.bearer(auth), json: { media_type: "video" }, step: "media.register", log });
    const bytes = await fetchMediaBytes(this.http, v, PIN_LIMITS.maxVideoBytes);
    const fd = new FormData();
    for (const [k, val] of Object.entries(reg.upload_parameters)) fd.set(k, val);
    fd.set("file", new Blob([bytes as BlobPart], { type: v.mimeType }));
    await call(this.http, "POST", reg.upload_url, { body: fd, raw: true, step: "media.upload", log });
    return { containerId: directMarker({ mediaId: reg.media_id }) };
  }

  async getPublishStatus(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void): Promise<ContainerStatus> {
    const { mediaId } = parseDirect<Direct>(containerId);
    if (!mediaId) return "ready";
    const s = await call<{ status: string }>(this.http, "GET", `${this.api}/v5/media/${mediaId}`, { headers: this.bearer(auth), step: "media.status", log });
    return s.status === "succeeded" ? "ready" : s.status === "failed" ? "error" : "in_progress";
  }

  /** Exact pin body. Exported for contract tests. */
  buildPin(boardId: string, input: PublishInput, d: Direct) {
    const base = { board_id: boardId, title: input.options.title ?? firstLine(input.caption, PIN_LIMITS.titleMax), description: input.caption.slice(0, PIN_LIMITS.descriptionMax), ...(input.options.link ? { link: input.options.link } : {}) };
    if (d.mediaId) return { ...base, media_source: { source_type: "video_id", media_id: d.mediaId, cover_image_url: input.cover?.publicUrl } };
    if (input.type === "carousel") return { ...base, media_source: { source_type: "multiple_image_urls", items: input.media.map((m) => ({ url: m.publicUrl })) } };
    return { ...base, media_source: { source_type: "image_url", url: input.media[0]?.publicUrl } };
  }

  async publish(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void, input?: PublishInput) {
    if (!input) throw new ProviderError("direct publish needs input", false, "INTERNAL");
    const r = await call<{ id: string }>(this.http, "POST", `${this.api}/v5/pins`, { headers: this.bearer(auth), json: this.buildPin(auth.externalId, input, parseDirect<Direct>(containerId)), step: "pin.create", log });
    return { externalPostId: r.id };
  }

  async getPostUrl(_auth: ChannelAuth, id: string) {
    return `https://www.pinterest.com/pin/${id}/`;
  }

  async fetchInsights(auth: ChannelAuth, id: string) {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 89 * 864e5).toISOString().slice(0, 10);
    const r = await call<{ all?: { lifetime_metrics?: Record<string, number> }; [k: string]: unknown }>(this.http, "GET", `${this.api}/v5/pins/${id}/analytics`, { query: { start_date: start, end_date: end, metric_types: "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK" }, headers: this.bearer(auth) });
    const m = r.all?.lifetime_metrics ?? {};
    const g = (k: string) => (typeof m[k] === "number" ? m[k]! : null);
    return { impressions: g("IMPRESSION"), saves: g("SAVE"), clicks: g("PIN_CLICK"), outbound_clicks: g("OUTBOUND_CLICK") };
  }

  async listComments() {
    return []; // no comments API in v5
  }
  async replyComment(): Promise<{ id: string }> {
    throw new CapabilityNotSupportedError("community.comments_reply");
  }
  async listMentions() {
    return [];
  }
}
