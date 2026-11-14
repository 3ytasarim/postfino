import { PLATFORM_CAPABILITIES } from "./capabilities";
import { call, directMarker, expiresIn, fetchMediaBytes, firstLine } from "./http";
import { CapabilityNotSupportedError, ProviderError, type ChannelAuth, type ConnectedAccount, type ContainerStatus, type HttpFetch, type OAuthFinish, type OAuthStart, type PlatformAdapter, type ProviderCallLog, type PublishInput, type ValidationIssue } from "./types";

// Google OAuth 2.0 shared by YouTube Data API v3 and the Business Profile APIs.
// YouTube: uploads from API projects that have not passed Google's audit are locked to "private" by YouTube.
// Business Profile: API access must be requested from Google (allow-list); local posts still use the v4 endpoint.

type GoogleOpts = { clientId: string; clientSecret: string; fetch?: HttpFetch };
const TOKEN_URL = "https://oauth2.googleapis.com/token";

abstract class GoogleBase {
  readonly isMock = false;
  readonly connectMode = "oauth_pkce" as const;
  protected readonly http: HttpFetch;
  constructor(protected readonly opts: GoogleOpts) {
    this.http = opts.fetch ?? fetch;
  }
  protected abstract scopes: string[];

  buildAuthUrl({ state, redirectUri, codeChallenge }: OAuthStart) {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", this.opts.clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", this.scopes.join(" "));
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent"); // always return a refresh token
    u.searchParams.set("include_granted_scopes", "true");
    u.searchParams.set("state", state);
    if (codeChallenge) {
      u.searchParams.set("code_challenge", codeChallenge);
      u.searchParams.set("code_challenge_method", "S256");
    }
    return u.toString();
  }

  protected async exchange({ code, redirectUri, codeVerifier }: OAuthFinish) {
    return call<{ access_token: string; expires_in: number; refresh_token?: string; scope: string }>(this.http, "POST", TOKEN_URL, {
      form: { code, client_id: this.opts.clientId, client_secret: this.opts.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: codeVerifier },
    });
  }

  async refreshToken(auth: ChannelAuth) {
    if (!auth.refreshToken) throw new ProviderError("missing Google refresh token", false, "REAUTH_REQUIRED");
    const t = await call<{ access_token: string; expires_in: number }>(this.http, "POST", TOKEN_URL, { form: { client_id: this.opts.clientId, client_secret: this.opts.clientSecret, refresh_token: auth.refreshToken, grant_type: "refresh_token" } });
    return { accessToken: t.access_token, expiresAt: expiresIn(t.expires_in) };
  }

  async disconnect(auth: ChannelAuth) {
    await call(this.http, "POST", "https://oauth2.googleapis.com/revoke", { form: { token: auth.refreshToken ?? auth.accessToken } }).catch(() => {});
  }

  protected bearer(auth: ChannelAuth) {
    return { authorization: `Bearer ${auth.accessToken}` };
  }
  async listMentions() {
    return [];
  }
}

// ── YouTube ──
export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.force-ssl"];
export const YT_LIMITS = { titleMax: 100, descriptionMax: 5000, maxBytes: 2 * 1024 ** 3 /* our own upload limit; YouTube allows 256 GB */, shortMaxDurationMs: 180_000, thumbMaxBytes: 2 * 1024 * 1024, thumbMimeTypes: ["image/jpeg", "image/png"] } as const;
const YT_PRIVACY = ["public", "unlisted", "private"];

export function validateYouTube(input: PublishInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!["video", "short", "reel"].includes(input.type)) out.push({ field: "type", code: "type_unsupported", message: "YouTube: nur Video oder Short" });
  const v = input.video ?? input.media[0];
  if (!v || v.kind !== "video") out.push({ field: "video", code: "video_required", message: "Video erforderlich" });
  else if (input.type !== "video" && v.durationMs !== undefined && v.durationMs > YT_LIMITS.shortMaxDurationMs) out.push({ field: "video", code: "short_too_long", message: "Shorts: max. 3 Minuten" });
  else if (input.type !== "video" && v.width && v.height && v.width > v.height) out.push({ field: "video", code: "short_orientation", message: "Shorts: Hoch- oder Quadratformat" });
  const title = input.options.title ?? firstLine(input.caption, 200);
  if (!title) out.push({ field: "title", code: "title_required", message: "Titel erforderlich (erste Zeile oder Titelfeld)" });
  else if (title.length > YT_LIMITS.titleMax) out.push({ field: "title", code: "title_too_long", message: `Titel max. ${YT_LIMITS.titleMax} Zeichen` });
  if (/[<>]/.test(title)) out.push({ field: "title", code: "title_chars", message: "Titel darf < und > nicht enthalten" });
  if (input.caption.length > YT_LIMITS.descriptionMax) out.push({ field: "caption", code: "caption_too_long", message: `Beschreibung max. ${YT_LIMITS.descriptionMax} Zeichen` });
  if (input.options.privacy && !YT_PRIVACY.includes(input.options.privacy)) out.push({ field: "privacy", code: "privacy_invalid", message: "public, unlisted oder private" });
  if (input.cover && !YT_LIMITS.thumbMimeTypes.includes(input.cover.mimeType as never)) out.push({ field: "cover", code: "cover_format", message: "Thumbnail: JPEG oder PNG" });
  return out;
}

export class YouTubeAdapter extends GoogleBase implements PlatformAdapter {
  readonly platform = "youtube" as const;
  protected scopes = YOUTUBE_SCOPES;

  getCapabilities() {
    return PLATFORM_CAPABILITIES.youtube;
  }
  validateContent(input: PublishInput) {
    return validateYouTube(input);
  }

  async exchangeCode(p: OAuthFinish): Promise<ConnectedAccount[]> {
    const t = await this.exchange(p);
    const ch = await call<{ items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url?: string } } } }[] }>(this.http, "GET", "https://www.googleapis.com/youtube/v3/channels", { query: { part: "snippet", mine: "true" }, headers: { authorization: `Bearer ${t.access_token}` } });
    return (ch.items ?? []).map((c) => ({ externalId: c.id, displayName: c.snippet.title, username: c.snippet.customUrl, avatarUrl: c.snippet.thumbnails?.default?.url, accessToken: t.access_token, refreshToken: t.refresh_token, tokenExpiresAt: expiresIn(t.expires_in), grantedScopes: t.scope.split(" "), meta: {} }));
  }

  async createMedia(_auth: ChannelAuth, input: PublishInput) {
    if (!["video", "short", "reel"].includes(input.type)) throw new CapabilityNotSupportedError(`post.${input.type}`);
    return { containerId: directMarker() }; // the upload itself creates the video
  }
  async getPublishStatus(): Promise<ContainerStatus> {
    return "ready";
  }

  /** Exact video resource for the upload. Exported for contract tests. */
  buildResource(input: PublishInput) {
    const title = (input.options.title ?? firstLine(input.caption, YT_LIMITS.titleMax)).slice(0, YT_LIMITS.titleMax);
    return { snippet: { title, description: input.caption.slice(0, YT_LIMITS.descriptionMax), categoryId: "22" }, status: { privacyStatus: input.options.privacy ?? "public", selfDeclaredMadeForKids: false } };
  }

  async publish(auth: ChannelAuth, _containerId: string, log: (l: ProviderCallLog) => void, input?: PublishInput) {
    if (!input) throw new ProviderError("direct publish needs input", false, "INTERNAL");
    const v = input.video ?? input.media[0]!;
    const bytes = await fetchMediaBytes(this.http, v, YT_LIMITS.maxBytes);
    const session = await call<Response>(this.http, "POST", "https://www.googleapis.com/upload/youtube/v3/videos", {
      query: { uploadType: "resumable", part: "snippet,status" },
      headers: { ...this.bearer(auth), "X-Upload-Content-Type": v.mimeType, "X-Upload-Content-Length": String(bytes.byteLength) },
      json: this.buildResource(input),
      raw: true,
      step: "upload.session",
      log,
    });
    const location = session.headers.get("location");
    if (!location) throw new ProviderError("YouTube did not return an upload session", true, "NO_UPLOAD_SESSION");
    const video = await call<{ id: string; status?: { uploadStatus?: string; privacyStatus?: string } }>(this.http, "PUT", location, { headers: { ...this.bearer(auth), "content-type": v.mimeType }, body: bytes as BodyInit, step: "upload.bytes", log, timeoutMs: 30 * 60_000 });
    // Independent thumbnail (custom thumbnails need a verified YouTube account) — best effort, never fails the post.
    if (input.cover) {
      try {
        const thumb = await fetchMediaBytes(this.http, input.cover, YT_LIMITS.thumbMaxBytes);
        await call(this.http, "POST", "https://www.googleapis.com/upload/youtube/v3/thumbnails/set", { query: { videoId: video.id }, headers: { ...this.bearer(auth), "content-type": input.cover.mimeType }, body: thumb as BodyInit, step: "thumbnail.set", log });
      } catch (e) {
        log({ step: "thumbnail.set", request: {}, response: { error: (e as Error).message }, durationMs: 0 });
      }
    }
    return { externalPostId: video.id };
  }

  async getPostUrl(_auth: ChannelAuth, id: string) {
    return `https://www.youtube.com/watch?v=${id}`;
  }

  async fetchInsights(auth: ChannelAuth, id: string) {
    const r = await call<{ items?: { statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(this.http, "GET", "https://www.googleapis.com/youtube/v3/videos", { query: { part: "statistics", id }, headers: this.bearer(auth) });
    const s = r.items?.[0]?.statistics;
    const n = (x?: string) => (x === undefined ? null : Number(x));
    return { views: n(s?.viewCount), likes: n(s?.likeCount), comments: n(s?.commentCount), shares: null, reach: null };
  }

  async fetchAccountInsights(auth: ChannelAuth) {
    const r = await call<{ items?: { statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }[] }>(this.http, "GET", "https://www.googleapis.com/youtube/v3/channels", { query: { part: "statistics", id: auth.externalId }, headers: this.bearer(auth) });
    const s = r.items?.[0]?.statistics;
    return { followers: s && !s.hiddenSubscriberCount && s.subscriberCount ? Number(s.subscriberCount) : null };
  }

  async listComments(auth: ChannelAuth, videoId: string) {
    const r = await call<{ items?: { snippet: { topLevelComment: { id: string; snippet: { textOriginal: string; authorDisplayName: string; publishedAt: string } } } }[] }>(this.http, "GET", "https://www.googleapis.com/youtube/v3/commentThreads", { query: { part: "snippet", videoId, maxResults: 100 }, headers: this.bearer(auth) });
    return (r.items ?? []).map((i) => ({ id: i.snippet.topLevelComment.id, text: i.snippet.topLevelComment.snippet.textOriginal, username: i.snippet.topLevelComment.snippet.authorDisplayName, timestamp: i.snippet.topLevelComment.snippet.publishedAt }));
  }

  async replyComment(auth: ChannelAuth, commentId: string, text: string) {
    const r = await call<{ id: string }>(this.http, "POST", "https://www.googleapis.com/youtube/v3/comments", { query: { part: "snippet" }, headers: this.bearer(auth), json: { snippet: { parentId: commentId, textOriginal: text } } });
    return { id: r.id };
  }
}

// ── Google Business Profile ──
export const GBP_SCOPES = ["https://www.googleapis.com/auth/business.manage"];
export const GBP_LIMITS = { summaryMax: 1500, imageMimeTypes: ["image/jpeg", "image/png"], minImageBytes: 10 * 1024, maxImageBytes: 5 * 1024 * 1024 } as const;

export function validateGoogleBusiness(input: PublishInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!["text", "image"].includes(input.type)) out.push({ field: "type", code: "type_unsupported", message: "Google Business: Text oder Bild" });
  if (!input.caption.trim()) out.push({ field: "caption", code: "text_required", message: "Text erforderlich" });
  if (input.caption.length > GBP_LIMITS.summaryMax) out.push({ field: "caption", code: "caption_too_long", message: `Max. ${GBP_LIMITS.summaryMax} Zeichen` });
  if (/(\+?\d[\d\s/-]{7,}\d)/.test(input.caption)) out.push({ field: "caption", code: "phone_in_text", message: "Telefonnummern im Text werden von Google abgelehnt" });
  if (input.type === "image") {
    const m = input.media[0];
    if (!m) out.push({ field: "media", code: "media_required", message: "Bild erforderlich" });
    else if (!GBP_LIMITS.imageMimeTypes.includes(m.mimeType as never) || m.sizeBytes < GBP_LIMITS.minImageBytes || m.sizeBytes > GBP_LIMITS.maxImageBytes) out.push({ field: "media", code: "image_format", message: "JPEG/PNG, 10 KB – 5 MB" });
  }
  if (input.options.link && !/^https?:\/\//.test(input.options.link)) out.push({ field: "link", code: "link_invalid", message: "Link muss mit https:// beginnen" });
  return out;
}

export class GoogleBusinessAdapter extends GoogleBase implements PlatformAdapter {
  readonly platform = "google_business" as const;
  protected scopes = GBP_SCOPES;

  getCapabilities() {
    return PLATFORM_CAPABILITIES.google_business;
  }
  validateContent(input: PublishInput) {
    return validateGoogleBusiness(input);
  }

  async exchangeCode(p: OAuthFinish): Promise<ConnectedAccount[]> {
    const t = await this.exchange(p);
    const h = { authorization: `Bearer ${t.access_token}` };
    const accounts = await call<{ accounts?: { name: string; accountName?: string }[] }>(this.http, "GET", "https://mybusinessaccountmanagement.googleapis.com/v1/accounts", { headers: h });
    const out: ConnectedAccount[] = [];
    for (const a of accounts.accounts ?? []) {
      const locs = await call<{ locations?: { name: string; title: string }[] }>(this.http, "GET", `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations`, { query: { readMask: "name,title", pageSize: 100 }, headers: h });
      for (const l of locs.locations ?? [])
        out.push({ externalId: `${a.name}/${l.name}`, displayName: l.title, accessToken: t.access_token, refreshToken: t.refresh_token, tokenExpiresAt: expiresIn(t.expires_in), grantedScopes: t.scope.split(" "), meta: { account: a.name, location: l.name } });
    }
    return out;
  }

  async createMedia(_auth: ChannelAuth, input: PublishInput) {
    if (!["text", "image"].includes(input.type)) throw new CapabilityNotSupportedError(`post.${input.type}`);
    return { containerId: directMarker() };
  }
  async getPublishStatus(): Promise<ContainerStatus> {
    return "ready";
  }

  /** Exact local post body. Exported for contract tests. */
  buildLocalPost(input: PublishInput) {
    return {
      languageCode: "de",
      summary: input.caption,
      topicType: "STANDARD",
      ...(input.type === "image" && input.media[0]?.publicUrl ? { media: [{ mediaFormat: "PHOTO", sourceUrl: input.media[0].publicUrl }] } : {}),
      ...(input.options.link ? { callToAction: { actionType: "LEARN_MORE", url: input.options.link } } : {}),
    };
  }

  async publish(auth: ChannelAuth, _c: string, log: (l: ProviderCallLog) => void, input?: PublishInput) {
    if (!input) throw new ProviderError("direct publish needs input", false, "INTERNAL");
    // externalId = "accounts/{a}/locations/{l}"
    const r = await call<{ name: string; searchUrl?: string }>(this.http, "POST", `https://mybusiness.googleapis.com/v4/${auth.externalId}/localPosts`, { headers: this.bearer(auth), json: this.buildLocalPost(input), step: "localPost.create", log });
    return { externalPostId: r.name };
  }

  async getPostUrl(auth: ChannelAuth, name: string) {
    const r = await call<{ searchUrl?: string }>(this.http, "GET", `https://mybusiness.googleapis.com/v4/${name}`, { headers: this.bearer(auth) });
    return r.searchUrl ?? null;
  }

  async fetchInsights() {
    // Per-post metrics were retired by Google; only location-level Performance API metrics exist.
    return { views: null, clicks: null };
  }

  async listComments(auth: ChannelAuth) {
    // Reviews are the "comments" of a location.
    const r = await call<{ reviews?: { name: string; reviewId: string; comment?: string; reviewer?: { displayName?: string }; createTime: string }[] }>(this.http, "GET", `https://mybusiness.googleapis.com/v4/${auth.externalId}/reviews`, { headers: this.bearer(auth) });
    return (r.reviews ?? []).map((v) => ({ id: v.name, text: v.comment ?? "", username: v.reviewer?.displayName, timestamp: v.createTime }));
  }

  async replyComment(auth: ChannelAuth, reviewName: string, text: string) {
    await call(this.http, "PUT", `https://mybusiness.googleapis.com/v4/${reviewName}/reply`, { headers: this.bearer(auth), json: { comment: text } });
    return { id: `${reviewName}/reply` };
  }
}
