import { PLATFORM_CAPABILITIES } from "./capabilities";
import { call, directMarker, expiresIn, fetchMediaBytes, parseDirect } from "./http";
import { CapabilityNotSupportedError, ProviderError, type ChannelAuth, type ConnectedAccount, type ContainerStatus, type HttpFetch, type OAuthFinish, type OAuthStart, type PlatformAdapter, type ProviderCallLog, type PublishInput, type ValidationIssue } from "./types";

// LinkedIn Posts API (versioned REST). Profiles post as urn:li:person (scope w_member_social, self-serve
// "Share on LinkedIn" product); pages post as urn:li:organization (Community Management API, w_organization_social,
// requires LinkedIn approval). Images/videos are uploaded first (initializeUpload → PUT), then referenced in the post.
// Docs: https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api

export const LINKEDIN_PROFILE_SCOPES = ["openid", "profile", "w_member_social"];
export const LINKEDIN_PAGE_SCOPES = ["w_organization_social", "r_organization_social", "rw_organization_admin"];
export const LI_LIMITS = { textMax: 3000, imageMimeTypes: ["image/jpeg", "image/png", "image/gif"], maxImageBytes: 36_152_320, maxVideoBytes: 500 * 1024 * 1024, videoMimeTypes: ["video/mp4"], maxImages: 20 } as const;

/** "little text" format: these characters must be escaped in commentary or the post is rejected/truncated. */
export function escapeLittleText(s: string) {
  return s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

export function validateLinkedIn(input: PublishInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (input.caption.length > LI_LIMITS.textMax) out.push({ field: "caption", code: "caption_too_long", message: `Max. ${LI_LIMITS.textMax} Zeichen` });
  if (!["text", "image", "carousel", "video"].includes(input.type)) out.push({ field: "type", code: "type_unsupported", message: `LinkedIn unterstützt ${input.type} nicht automatisch` });
  if (input.type === "text" && !input.caption.trim()) out.push({ field: "caption", code: "text_required", message: "Text erforderlich" });
  if (input.type === "image" || input.type === "carousel") {
    if (input.media.length === 0) out.push({ field: "media", code: "media_required", message: "Bild erforderlich" });
    if (input.media.length > LI_LIMITS.maxImages) out.push({ field: "media", code: "too_many_images", message: `Max. ${LI_LIMITS.maxImages} Bilder` });
    for (const m of input.media) if (!LI_LIMITS.imageMimeTypes.includes(m.mimeType as never)) out.push({ field: "media", code: "image_format", message: "JPEG, PNG oder GIF" });
  }
  if (input.type === "video") {
    const v = input.video ?? input.media[0];
    if (!v || v.kind !== "video") out.push({ field: "video", code: "video_required", message: "Video erforderlich" });
    else if (v.sizeBytes > LI_LIMITS.maxVideoBytes) out.push({ field: "video", code: "video_too_large", message: "Max. 500 MB" });
  }
  return out;
}

type Direct = { images?: string[]; video?: string };

export class LinkedInAdapter implements PlatformAdapter {
  readonly isMock = false;
  readonly connectMode = "oauth" as const;
  private readonly http: HttpFetch;
  private readonly api = "https://api.linkedin.com";

  constructor(
    readonly platform: "linkedin_profile" | "linkedin_page",
    private readonly opts: { clientId: string; clientSecret: string; version: string; fetch?: HttpFetch },
  ) {
    this.http = opts.fetch ?? fetch;
  }

  getCapabilities() {
    return PLATFORM_CAPABILITIES[this.platform];
  }
  validateContent(input: PublishInput) {
    return validateLinkedIn(input);
  }

  private headers(token: string) {
    return { authorization: `Bearer ${token}`, "LinkedIn-Version": this.opts.version, "X-Restli-Protocol-Version": "2.0.0" };
  }

  buildAuthUrl({ state, redirectUri }: OAuthStart) {
    const u = new URL("https://www.linkedin.com/oauth/v2/authorization");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", this.opts.clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("scope", (this.platform === "linkedin_page" ? [...LINKEDIN_PROFILE_SCOPES, ...LINKEDIN_PAGE_SCOPES] : LINKEDIN_PROFILE_SCOPES).join(" "));
    return u.toString();
  }

  async exchangeCode({ code, redirectUri }: OAuthFinish): Promise<ConnectedAccount[]> {
    const tok = await call<{ access_token: string; expires_in: number; refresh_token?: string; scope?: string }>(this.http, "POST", "https://www.linkedin.com/oauth/v2/accessToken", {
      form: { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: this.opts.clientId, client_secret: this.opts.clientSecret },
    });
    const scopes = (tok.scope ?? "").split(/[ ,]+/).filter(Boolean);
    const base = { accessToken: tok.access_token, refreshToken: tok.refresh_token, tokenExpiresAt: expiresIn(tok.expires_in), grantedScopes: scopes };
    if (this.platform === "linkedin_profile") {
      const me = await call<{ sub: string; name?: string; picture?: string; email?: string }>(this.http, "GET", `${this.api}/v2/userinfo`, { headers: { authorization: `Bearer ${tok.access_token}` } });
      return [{ ...base, externalId: me.sub, displayName: me.name ?? "LinkedIn", avatarUrl: me.picture, meta: { author: `urn:li:person:${me.sub}` } }];
    }
    const acls = await call<{ elements: { organization: string; role: string; state: string }[] }>(this.http, "GET", `${this.api}/rest/organizationAcls`, {
      query: { q: "roleAssignee", role: "ADMINISTRATOR", state: "APPROVED" },
      headers: this.headers(tok.access_token),
    });
    const out: ConnectedAccount[] = [];
    for (const a of acls.elements ?? []) {
      const id = a.organization.split(":").pop()!;
      const org = await call<{ localizedName?: string; vanityName?: string }>(this.http, "GET", `${this.api}/rest/organizations/${id}`, { headers: this.headers(tok.access_token) }).catch(() => ({}) as { localizedName?: string; vanityName?: string });
      out.push({ ...base, externalId: id, displayName: org.localizedName ?? `Organisation ${id}`, username: org.vanityName, meta: { author: a.organization } });
    }
    return out;
  }

  async refreshToken(auth: ChannelAuth) {
    // Programmatic refresh tokens are only issued to approved partners; otherwise the user re-authorises after 60 days.
    if (!auth.refreshToken) throw new ProviderError("LinkedIn token cannot be refreshed — reconnect required", false, "REAUTH_REQUIRED");
    const tok = await call<{ access_token: string; expires_in: number; refresh_token?: string }>(this.http, "POST", "https://www.linkedin.com/oauth/v2/accessToken", {
      form: { grant_type: "refresh_token", refresh_token: auth.refreshToken, client_id: this.opts.clientId, client_secret: this.opts.clientSecret },
    });
    return { accessToken: tok.access_token, expiresAt: expiresIn(tok.expires_in), refreshToken: tok.refresh_token };
  }

  async disconnect() {
    /* LinkedIn has no token revocation endpoint for 3-legged tokens; credentials are deleted locally. */
  }

  private author(auth: ChannelAuth) {
    return String(auth.meta.author ?? (this.platform === "linkedin_page" ? `urn:li:organization:${auth.externalId}` : `urn:li:person:${auth.externalId}`));
  }

  async createMedia(auth: ChannelAuth, input: PublishInput, log: (l: ProviderCallLog) => void) {
    const owner = this.author(auth);
    if (input.type === "image" || input.type === "carousel") {
      const images: string[] = [];
      for (const m of input.media) {
        const init = await call<{ value: { uploadUrl: string; image: string } }>(this.http, "POST", `${this.api}/rest/images`, { query: { action: "initializeUpload" }, headers: this.headers(auth.accessToken), json: { initializeUploadRequest: { owner } }, step: "image.initialize", log });
        const bytes = await fetchMediaBytes(this.http, m, LI_LIMITS.maxImageBytes);
        await call(this.http, "PUT", init.value.uploadUrl, { headers: { authorization: `Bearer ${auth.accessToken}`, "content-type": m.mimeType }, body: bytes as BodyInit, raw: true, step: "image.upload", log });
        images.push(init.value.image);
      }
      return { containerId: directMarker({ images }) };
    }
    if (input.type === "video") {
      const v = input.video ?? input.media[0]!;
      const bytes = await fetchMediaBytes(this.http, v, LI_LIMITS.maxVideoBytes);
      const init = await call<{ value: { video: string; uploadToken: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] } }>(this.http, "POST", `${this.api}/rest/videos`, {
        query: { action: "initializeUpload" },
        headers: this.headers(auth.accessToken),
        json: { initializeUploadRequest: { owner, fileSizeBytes: bytes.byteLength, uploadCaptions: false, uploadThumbnail: false } },
        step: "video.initialize",
        log,
      });
      const etags: string[] = [];
      for (const part of init.value.uploadInstructions) {
        const res = await call<Response>(this.http, "PUT", part.uploadUrl, { headers: { "content-type": "application/octet-stream" }, body: bytes.slice(part.firstByte, part.lastByte + 1) as BodyInit, raw: true, step: "video.upload_part", log });
        etags.push(res.headers.get("etag") ?? "");
      }
      await call(this.http, "POST", `${this.api}/rest/videos`, { query: { action: "finalizeUpload" }, headers: this.headers(auth.accessToken), json: { finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken, uploadedPartIds: etags } }, step: "video.finalize", log });
      return { containerId: directMarker({ video: init.value.video }) };
    }
    if (input.type === "text") return { containerId: directMarker() };
    throw new CapabilityNotSupportedError(`post.${input.type}`);
  }

  async getPublishStatus(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void): Promise<ContainerStatus> {
    const d = parseDirect<Direct>(containerId);
    if (!d.video) return "ready";
    const v = await call<{ status: string }>(this.http, "GET", `${this.api}/rest/videos/${encodeURIComponent(d.video)}`, { headers: this.headers(auth.accessToken), step: "video.status", log });
    return v.status === "AVAILABLE" ? "ready" : v.status === "PROCESSING_FAILED" ? "error" : "in_progress";
  }

  /** Exact request body for a post. Exported for contract tests. */
  buildPost(author: string, input: PublishInput, d: Direct) {
    const body: Record<string, unknown> = {
      author,
      commentary: escapeLittleText(input.caption),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    if (d.images?.length === 1) body.content = { media: { id: d.images[0] } };
    else if (d.images && d.images.length > 1) body.content = { multiImage: { images: d.images.map((id) => ({ id })) } };
    else if (d.video) body.content = { media: { id: d.video, title: input.options.title ?? undefined } };
    return body;
  }

  async publish(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void, input?: PublishInput) {
    if (!input) throw new ProviderError("direct publish needs input", false, "INTERNAL");
    const res = await call<Response>(this.http, "POST", `${this.api}/rest/posts`, { headers: this.headers(auth.accessToken), json: this.buildPost(this.author(auth), input, parseDirect<Direct>(containerId)), raw: true, step: "post.create", log });
    const id = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
    if (!id) throw new ProviderError("LinkedIn did not return a post id", false, "NO_POST_ID");
    return { externalPostId: id };
  }

  async getPostUrl(_auth: ChannelAuth, externalPostId: string) {
    return `https://www.linkedin.com/feed/update/${externalPostId}/`;
  }

  async fetchInsights(auth: ChannelAuth, externalPostId: string) {
    // socialActions is available for both members and organisations; impressions only for organisation shares.
    const sa = await call<{ likesSummary?: { totalLikes?: number }; commentsSummary?: { aggregatedTotalComments?: number } }>(this.http, "GET", `${this.api}/rest/socialActions/${encodeURIComponent(externalPostId)}`, { headers: this.headers(auth.accessToken) });
    return { likes: sa.likesSummary?.totalLikes ?? null, comments: sa.commentsSummary?.aggregatedTotalComments ?? null, impressions: null, reach: null, shares: null };
  }

  async listComments(auth: ChannelAuth, externalPostId: string) {
    const r = await call<{ elements?: { id?: string; $URN?: string; message?: { text?: string }; actor?: string; created?: { time?: number } }[] }>(this.http, "GET", `${this.api}/rest/socialActions/${encodeURIComponent(externalPostId)}/comments`, { headers: this.headers(auth.accessToken) });
    return (r.elements ?? []).map((c) => ({ id: c.$URN ?? c.id ?? "", text: c.message?.text ?? "", username: c.actor, timestamp: new Date(c.created?.time ?? 0).toISOString() }));
  }

  async replyComment(auth: ChannelAuth, commentId: string, text: string) {
    // commentId is the comment URN: urn:li:comment:(urn:li:activity:…,123)
    const object = /^urn:li:comment:\((.+),\d+\)$/.exec(commentId)?.[1];
    if (!object) throw new ProviderError("unexpected comment id", false, "INVALID_COMMENT_ID");
    const res = await call<Response>(this.http, "POST", `${this.api}/rest/socialActions/${encodeURIComponent(object)}/comments`, {
      headers: this.headers(auth.accessToken),
      json: { actor: String(auth.meta.author), object, parentComment: commentId, message: { text } },
      raw: true,
    });
    return { id: res.headers.get("x-restli-id") ?? "" };
  }

  async listMentions() {
    return [];
  }
}
