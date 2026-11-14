import { PLATFORM_CAPABILITIES } from "./capabilities";
import { call, directMarker, expiresIn, firstLine } from "./http";
import { CapabilityNotSupportedError, ProviderError, type ChannelAuth, type ConnectedAccount, type ContainerStatus, type HttpFetch, type OAuthFinish, type OAuthStart, type PlatformAdapter, type ProviderCallLog, type PublishInput, type ValidationIssue } from "./types";

// TikTok Content Posting API v2 (Direct Post). Until TikTok audits the app, every post is restricted to
// SELF_ONLY visibility — the UI must say so. The UX guidelines require the user to pick the privacy level
// from creator_info (no default), so `options.privacy` is mandatory for TikTok targets.
// Media is pulled by TikTok from our media domain (PULL_FROM_URL) — that domain must be verified in the TikTok
// developer portal. Docs: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post

export const TIKTOK_SCOPES = ["user.info.basic", "video.publish", "video.upload"];
export const TIKTOK_PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;
export const TT_LIMITS = { titleMax: 2200, photoTitleMax: 90, maxPhotos: 35, videoMimeTypes: ["video/mp4", "video/quicktime", "video/webm"], minDurationMs: 3_000, maxDurationMs: 10 * 60_000, photoMimeTypes: ["image/jpeg", "image/webp"] } as const;

export function validateTikTok(input: PublishInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!input.options.privacy || !TIKTOK_PRIVACY.includes(input.options.privacy as never)) out.push({ field: "privacy", code: "privacy_required", message: "TikTok: Sichtbarkeit muss ausgewählt werden" });
  if (["video", "reel", "short"].includes(input.type)) {
    const v = input.video ?? input.media[0];
    if (!v || v.kind !== "video") out.push({ field: "video", code: "video_required", message: "Video erforderlich" });
    else {
      if (!TT_LIMITS.videoMimeTypes.includes(v.mimeType as never)) out.push({ field: "video", code: "video_format", message: "MP4, MOV oder WebM" });
      if (v.durationMs !== undefined && (v.durationMs < TT_LIMITS.minDurationMs || v.durationMs > TT_LIMITS.maxDurationMs)) out.push({ field: "video", code: "video_duration", message: "3 s bis 10 min" });
    }
    if (input.caption.length > TT_LIMITS.titleMax) out.push({ field: "caption", code: "caption_too_long", message: `Max. ${TT_LIMITS.titleMax} Zeichen` });
  } else if (input.type === "image" || input.type === "carousel") {
    if (input.media.length === 0 || input.media.length > TT_LIMITS.maxPhotos) out.push({ field: "media", code: "photo_count", message: `1–${TT_LIMITS.maxPhotos} Bilder` });
    for (const m of input.media) if (!TT_LIMITS.photoMimeTypes.includes(m.mimeType as never)) out.push({ field: "media", code: "image_format", message: "JPEG oder WebP" });
  } else out.push({ field: "type", code: "type_unsupported", message: `TikTok unterstützt ${input.type} nicht` });
  return out;
}

export class TikTokAdapter implements PlatformAdapter {
  readonly platform = "tiktok" as const;
  readonly isMock = false;
  readonly connectMode = "oauth" as const;
  private readonly http: HttpFetch;
  private readonly api = "https://open.tiktokapis.com";

  constructor(private readonly opts: { clientKey: string; clientSecret: string; fetch?: HttpFetch; sleep?: (ms: number) => Promise<void> }) {
    this.http = opts.fetch ?? fetch;
  }

  getCapabilities() {
    return PLATFORM_CAPABILITIES.tiktok;
  }
  validateContent(input: PublishInput) {
    return validateTikTok(input);
  }

  buildAuthUrl({ state, redirectUri }: OAuthStart) {
    const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
    u.searchParams.set("client_key", this.opts.clientKey);
    u.searchParams.set("scope", TIKTOK_SCOPES.join(","));
    u.searchParams.set("response_type", "code");
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    return u.toString();
  }

  private async token(form: Record<string, string>) {
    const t = await call<{ access_token: string; expires_in: number; refresh_token: string; refresh_expires_in: number; open_id: string; scope: string }>(this.http, "POST", `${this.api}/v2/oauth/token/`, {
      form: { client_key: this.opts.clientKey, client_secret: this.opts.clientSecret, ...form },
    });
    if (!t.access_token) throw new ProviderError("TikTok token exchange failed", false, "TOKEN");
    return t;
  }

  async exchangeCode({ code, redirectUri }: OAuthFinish): Promise<ConnectedAccount[]> {
    const t = await this.token({ code, grant_type: "authorization_code", redirect_uri: redirectUri });
    const me = await call<{ data: { user: { open_id: string; display_name?: string; avatar_url?: string; username?: string } } }>(this.http, "GET", `${this.api}/v2/user/info/`, {
      query: { fields: "open_id,display_name,avatar_url,username" },
      headers: { authorization: `Bearer ${t.access_token}` },
    });
    const u = me.data.user;
    return [{ externalId: u.open_id ?? t.open_id, displayName: u.display_name ?? "TikTok", username: u.username, avatarUrl: u.avatar_url, accessToken: t.access_token, refreshToken: t.refresh_token, tokenExpiresAt: expiresIn(t.expires_in), grantedScopes: t.scope.split(","), meta: {} }];
  }

  async refreshToken(auth: ChannelAuth) {
    if (!auth.refreshToken) throw new ProviderError("missing TikTok refresh token", false, "REAUTH_REQUIRED");
    const t = await this.token({ grant_type: "refresh_token", refresh_token: auth.refreshToken });
    return { accessToken: t.access_token, expiresAt: expiresIn(t.expires_in), refreshToken: t.refresh_token };
  }

  async disconnect(auth: ChannelAuth) {
    await call(this.http, "POST", `${this.api}/v2/oauth/revoke/`, { form: { client_key: this.opts.clientKey, client_secret: this.opts.clientSecret, token: auth.accessToken } }).catch(() => {});
  }

  /** Creator info must be queried before every post (privacy options, limits, whether posting is allowed). */
  async creatorInfo(auth: ChannelAuth) {
    const r = await call<{ data: { privacy_level_options: string[]; comment_disabled: boolean; duet_disabled: boolean; stitch_disabled: boolean; max_video_post_duration_sec: number } }>(this.http, "POST", `${this.api}/v2/post/publish/creator_info/query/`, {
      headers: { authorization: `Bearer ${auth.accessToken}` },
      json: {},
    });
    return r.data;
  }

  async createMedia(_auth: ChannelAuth, input: PublishInput) {
    if (!["video", "reel", "short", "image", "carousel"].includes(input.type)) throw new CapabilityNotSupportedError(`post.${input.type}`);
    // Init == publish on TikTok: nothing is sent before publish() (single-call, never retried after an unknown outcome).
    return { containerId: directMarker() };
  }

  async getPublishStatus(): Promise<ContainerStatus> {
    return "ready";
  }

  /** Exact init body. Exported for contract tests. */
  buildInit(input: PublishInput, creator: { privacy_level_options: string[]; comment_disabled: boolean; duet_disabled: boolean; stitch_disabled: boolean }) {
    const privacy = input.options.privacy!;
    if (!creator.privacy_level_options.includes(privacy)) throw new ProviderError(`privacy ${privacy} not allowed for this creator (allowed: ${creator.privacy_level_options.join(", ")})`, false, "PRIVACY_NOT_ALLOWED");
    if (input.type === "image" || input.type === "carousel") {
      return {
        path: "/v2/post/publish/content/init/",
        body: {
          post_info: { title: input.options.title ?? firstLine(input.caption, TT_LIMITS.photoTitleMax), description: input.caption.slice(0, 4000), privacy_level: privacy, disable_comment: creator.comment_disabled },
          source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: input.media.map((m) => m.publicUrl) },
          post_mode: "DIRECT_POST",
          media_type: "PHOTO",
        },
      };
    }
    const v = input.video ?? input.media[0]!;
    return {
      path: "/v2/post/publish/video/init/",
      body: {
        post_info: { title: input.caption.slice(0, TT_LIMITS.titleMax), privacy_level: privacy, disable_comment: creator.comment_disabled, disable_duet: creator.duet_disabled, disable_stitch: creator.stitch_disabled, ...(input.thumbOffsetMs !== undefined ? { video_cover_timestamp_ms: input.thumbOffsetMs } : {}) },
        source_info: { source: "PULL_FROM_URL", video_url: v.publicUrl },
      },
    };
  }

  async publish(auth: ChannelAuth, _containerId: string, log: (l: ProviderCallLog) => void, input?: PublishInput) {
    if (!input) throw new ProviderError("direct publish needs input", false, "INTERNAL");
    const creator = await this.creatorInfo(auth);
    const init = this.buildInit(input, creator);
    const r = await call<{ data: { publish_id: string } }>(this.http, "POST", this.api + init.path, { headers: { authorization: `Bearer ${auth.accessToken}` }, json: init.body, step: "publish.init", log });
    const publishId = r.data.publish_id;
    // Processing is asynchronous. Poll briefly for the public post id; otherwise keep the publish_id.
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((res) => setTimeout(res, ms)));
    for (let i = 0; i < 12; i++) {
      const s = await call<{ data: { status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] } }>(this.http, "POST", `${this.api}/v2/post/publish/status/fetch/`, { headers: { authorization: `Bearer ${auth.accessToken}` }, json: { publish_id: publishId }, step: "publish.status", log });
      if (s.data.status === "FAILED") throw new ProviderError(`TikTok: ${s.data.fail_reason ?? "failed"}`, false, "PUBLISH_FAILED");
      if (s.data.status === "PUBLISH_COMPLETE") {
        const id = s.data.publicaly_available_post_id?.[0];
        return { externalPostId: id ? String(id) : `publish:${publishId}` };
      }
      await sleep(5_000);
    }
    return { externalPostId: `publish:${publishId}` };
  }

  async getPostUrl(auth: ChannelAuth, externalPostId: string) {
    if (externalPostId.startsWith("publish:")) return null; // SELF_ONLY / still processing: no public URL
    const username = auth.meta.username as string | undefined;
    return username ? `https://www.tiktok.com/@${username}/video/${externalPostId}` : null;
  }

  async fetchInsights(auth: ChannelAuth, externalPostId: string) {
    if (externalPostId.startsWith("publish:")) return { views: null, likes: null, comments: null, shares: null };
    const r = await call<{ data: { videos: { view_count?: number; like_count?: number; comment_count?: number; share_count?: number }[] } }>(this.http, "POST", `${this.api}/v2/video/query/`, {
      query: { fields: "id,view_count,like_count,comment_count,share_count" },
      headers: { authorization: `Bearer ${auth.accessToken}` },
      json: { filters: { video_ids: [externalPostId] } },
    });
    const v = r.data.videos[0];
    return { views: v?.view_count ?? null, likes: v?.like_count ?? null, comments: v?.comment_count ?? null, shares: v?.share_count ?? null };
  }

  async listComments() {
    return []; // no comment API for third-party apps
  }
  async replyComment(): Promise<{ id: string }> {
    throw new CapabilityNotSupportedError("community.comments_reply");
  }
  async listMentions() {
    return [];
  }
}
