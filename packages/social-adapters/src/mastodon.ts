import { PLATFORM_CAPABILITIES } from "./capabilities";
import { call, directMarker, fetchMediaBytes, parseDirect, splitThread } from "./http";
import { CapabilityNotSupportedError, ProviderError, type ChannelAuth, type ConnectedAccount, type ContainerStatus, type HttpFetch, type OAuthFinish, type OAuthStart, type PlatformAdapter, type ProviderCallLog, type PublishInput, type ValidationIssue } from "./types";

// Mastodon (any instance). Federated: an OAuth app is registered on each instance the first time a user
// connects (POST /api/v1/apps — free, no review) and stored encrypted by core (oauth_client_apps).
// Tokens do not expire. Statuses are created with an Idempotency-Key, which Mastodon honours for 1 hour —
// the post-target id is used, so a retried publish cannot create a duplicate.
// Docs: https://docs.joinmastodon.org/methods/statuses/#create

export const MASTODON_SCOPES = "read write:statuses write:media";
export const MASTO_LIMITS = { textMax: 500, maxImages: 4, maxImageBytes: 16 * 1024 * 1024, maxVideoBytes: 99 * 1024 * 1024 } as const;

export type MastodonAppStore = {
  get(instance: string, redirectUri: string): Promise<{ clientId: string; clientSecret: string } | null>;
  save(instance: string, redirectUri: string, app: { clientId: string; clientSecret: string; scopes: string }): Promise<void>;
};

/** Normalises user input ("mastodon.social", "https://chaos.social/@x") to a bare host; rejects anything else. */
export function normalizeInstance(input: string) {
  const raw = input.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/?#@]/)[0] ?? "";
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(raw)) throw new ProviderError("Ungültige Instanz-Adresse", false, "INVALID_INSTANCE");
  return raw;
}

export function validateMastodon(input: PublishInput, maxChars: number = MASTO_LIMITS.textMax): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const parts = input.type === "thread" ? splitThread(input.caption) : [input.caption];
  // Mastodon counts every URL as 23 characters.
  parts.forEach((p, i) => {
    if ([...p.replace(/https?:\/\/\S+/g, "x".repeat(23))].length > maxChars) out.push({ field: "caption", code: "caption_too_long", message: `Teil ${i + 1}: max. ${maxChars} Zeichen` });
  });
  if (!["text", "image", "carousel", "video", "thread"].includes(input.type)) out.push({ field: "type", code: "type_unsupported", message: `Mastodon unterstützt ${input.type} nicht` });
  if (input.media.length > MASTO_LIMITS.maxImages) out.push({ field: "media", code: "too_many_images", message: "Max. 4 Anhänge" });
  return out;
}

type Direct = { mediaIds?: string[] };

export class MastodonAdapter implements PlatformAdapter {
  readonly platform = "mastodon" as const;
  readonly isMock = false;
  readonly connectMode = "oauth_instance" as const;
  private readonly http: HttpFetch;

  constructor(private readonly opts: { store: MastodonAppStore; appName: string; website: string; assertPublicHost: (host: string) => Promise<void>; fetch?: HttpFetch }) {
    this.http = opts.fetch ?? fetch;
  }

  getCapabilities() {
    return PLATFORM_CAPABILITIES.mastodon;
  }
  validateContent(input: PublishInput) {
    return validateMastodon(input);
  }

  private async app(instance: string, redirectUri: string) {
    const host = normalizeInstance(instance);
    await this.opts.assertPublicHost(host);
    const known = await this.opts.store.get(host, redirectUri);
    if (known) return { host, ...known };
    const r = await call<{ client_id: string; client_secret: string }>(this.http, "POST", `https://${host}/api/v1/apps`, { json: { client_name: this.opts.appName, redirect_uris: redirectUri, scopes: MASTODON_SCOPES, website: this.opts.website } });
    await this.opts.store.save(host, redirectUri, { clientId: r.client_id, clientSecret: r.client_secret, scopes: MASTODON_SCOPES });
    return { host, clientId: r.client_id, clientSecret: r.client_secret };
  }

  async buildAuthUrl({ state, redirectUri, instance }: OAuthStart) {
    if (!instance) throw new ProviderError("Mastodon instance required", false, "INSTANCE_REQUIRED");
    const a = await this.app(instance, redirectUri);
    const u = new URL(`https://${a.host}/oauth/authorize`);
    u.searchParams.set("client_id", a.clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", MASTODON_SCOPES);
    u.searchParams.set("state", state);
    return u.toString();
  }

  async exchangeCode({ code, redirectUri, instance }: OAuthFinish): Promise<ConnectedAccount[]> {
    if (!instance) throw new ProviderError("Mastodon instance required", false, "INSTANCE_REQUIRED");
    const a = await this.app(instance, redirectUri);
    const t = await call<{ access_token: string; scope: string }>(this.http, "POST", `https://${a.host}/oauth/token`, { form: { grant_type: "authorization_code", code, client_id: a.clientId, client_secret: a.clientSecret, redirect_uri: redirectUri, scope: MASTODON_SCOPES } });
    const me = await call<{ id: string; username: string; acct: string; display_name?: string; avatar?: string }>(this.http, "GET", `https://${a.host}/api/v1/accounts/verify_credentials`, { headers: { authorization: `Bearer ${t.access_token}` } });
    const limits = await call<{ configuration?: { statuses?: { max_characters?: number } } }>(this.http, "GET", `https://${a.host}/api/v2/instance`).catch(() => ({}) as { configuration?: { statuses?: { max_characters?: number } } });
    return [{ externalId: me.id, displayName: me.display_name || `@${me.username}`, username: `${me.username}@${a.host}`, avatarUrl: me.avatar, accessToken: t.access_token, grantedScopes: t.scope.split(" "), meta: { instance: a.host, maxCharacters: limits.configuration?.statuses?.max_characters ?? MASTO_LIMITS.textMax } }];
  }

  async refreshToken(auth: ChannelAuth) {
    await call(this.http, "GET", `${this.base(auth)}/api/v1/accounts/verify_credentials`, { headers: this.bearer(auth) });
    return { accessToken: auth.accessToken }; // Mastodon tokens do not expire
  }

  async disconnect(auth: ChannelAuth) {
    const host = String(auth.meta.instance);
    const app = await this.opts.store.get(host, "").catch(() => null);
    if (app) await call(this.http, "POST", `https://${host}/oauth/revoke`, { form: { client_id: app.clientId, client_secret: app.clientSecret, token: auth.accessToken } }).catch(() => {});
  }

  private base(auth: ChannelAuth) {
    return `https://${normalizeInstance(String(auth.meta.instance ?? ""))}`;
  }
  private bearer(auth: ChannelAuth) {
    return { authorization: `Bearer ${auth.accessToken}` };
  }

  async createMedia(auth: ChannelAuth, input: PublishInput, log: (l: ProviderCallLog) => void) {
    if (!["text", "image", "carousel", "video", "thread"].includes(input.type)) throw new CapabilityNotSupportedError(`post.${input.type}`);
    const media = [...input.media, ...(input.video && !input.media.includes(input.video) ? [input.video] : [])];
    const mediaIds: string[] = [];
    for (const m of media) {
      const bytes = await fetchMediaBytes(this.http, m, m.kind === "video" ? MASTO_LIMITS.maxVideoBytes : MASTO_LIMITS.maxImageBytes);
      const fd = new FormData();
      fd.set("file", new Blob([bytes as BlobPart], { type: m.mimeType }), m.kind === "video" ? "video.mp4" : "image");
      const r = await call<{ id: string }>(this.http, "POST", `${this.base(auth)}/api/v2/media`, { headers: this.bearer(auth), body: fd, step: "media.upload", log });
      mediaIds.push(r.id);
    }
    return { containerId: directMarker({ mediaIds }) };
  }

  async getPublishStatus(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void): Promise<ContainerStatus> {
    for (const id of parseDirect<Direct>(containerId).mediaIds ?? []) {
      const m = await call<{ url: string | null }>(this.http, "GET", `${this.base(auth)}/api/v1/media/${id}`, { headers: this.bearer(auth), step: "media.status", log });
      if (!m.url) return "in_progress"; // still processing (HTTP 206 on some versions)
    }
    return "ready";
  }

  /** Exact status bodies (one per thread part). Exported for contract tests. */
  buildStatuses(input: PublishInput, mediaIds: string[]) {
    const parts = input.type === "thread" ? splitThread(input.caption) : [input.caption];
    return parts.map((status, i) => ({ status, visibility: "public", language: "de", ...(i === 0 && mediaIds.length ? { media_ids: mediaIds } : {}) }));
  }

  async publish(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void, input?: PublishInput) {
    if (!input) throw new ProviderError("direct publish needs input", false, "INTERNAL");
    const statuses = this.buildStatuses(input, parseDirect<Direct>(containerId).mediaIds ?? []);
    const idemBase = containerId.length > 200 ? containerId.slice(0, 200) : containerId;
    let first: string | undefined;
    let prev: string | undefined;
    for (const [i, s] of statuses.entries()) {
      try {
        const r = await call<{ id: string }>(this.http, "POST", `${this.base(auth)}/api/v1/statuses`, {
          headers: { ...this.bearer(auth), "Idempotency-Key": `st:${idemBase}:${i}` },
          json: { ...s, ...(prev ? { in_reply_to_id: prev } : {}) },
          step: `status.create.${i}`,
          log,
        });
        prev = r.id;
        first ??= r.id;
      } catch (e) {
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
    const r = await call<{ url?: string }>(this.http, "GET", `${this.base(auth)}/api/v1/statuses/${id}`, { headers: this.bearer(auth) });
    return r.url ?? null;
  }

  async fetchInsights(auth: ChannelAuth, id: string) {
    const r = await call<{ favourites_count: number; reblogs_count: number; replies_count: number }>(this.http, "GET", `${this.base(auth)}/api/v1/statuses/${id}`, { headers: this.bearer(auth) });
    return { likes: r.favourites_count, shares: r.reblogs_count, comments: r.replies_count, impressions: null };
  }

  async fetchAccountInsights(auth: ChannelAuth) {
    const r = await call<{ followers_count?: number }>(this.http, "GET", `${this.base(auth)}/api/v1/accounts/verify_credentials`, { headers: this.bearer(auth) });
    return { followers: r.followers_count ?? null };
  }

  async listComments(auth: ChannelAuth, id: string) {
    const r = await call<{ descendants: { id: string; content: string; account: { acct: string }; created_at: string; in_reply_to_id?: string }[] }>(this.http, "GET", `${this.base(auth)}/api/v1/statuses/${id}/context`, { headers: this.bearer(auth) });
    const strip = (html: string) => html.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return r.descendants.map((d) => ({ id: d.id, text: strip(d.content), username: d.account.acct, timestamp: d.created_at, parentId: d.in_reply_to_id }));
  }

  async replyComment(auth: ChannelAuth, commentId: string, text: string) {
    const r = await call<{ id: string }>(this.http, "POST", `${this.base(auth)}/api/v1/statuses`, { headers: { ...this.bearer(auth), "Idempotency-Key": `reply:${commentId}:${text.length}:${text.slice(0, 40)}` }, json: { status: text, in_reply_to_id: commentId, visibility: "public" } });
    return { id: r.id };
  }

  async listMentions(auth: ChannelAuth) {
    return call<unknown[]>(this.http, "GET", `${this.base(auth)}/api/v1/notifications`, { query: { "types[]": "mention" }, headers: this.bearer(auth) });
  }
}
