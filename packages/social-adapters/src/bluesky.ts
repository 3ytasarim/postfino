import { PLATFORM_CAPABILITIES } from "./capabilities";
import { call, directMarker, fetchMediaBytes, graphemes, parseDirect, splitThread } from "./http";
import { CapabilityNotSupportedError, ProviderError, type ChannelAuth, type ConnectedAccount, type ContainerStatus, type HttpFetch, type PlatformAdapter, type ProviderCallLog, type PublishInput, type ValidationIssue } from "./types";

// Bluesky via the AT Protocol XRPC API. Connected with an *app password* (Settings → App Passwords): it is used
// once for com.atproto.server.createSession and never stored — we keep only the session JWTs (access ≈ 2 h,
// refresh ≈ 2 months, both encrypted). Calls go to the account's own PDS from the DID document.
// Images are uploaded as blobs; links become facets (UTF-8 byte offsets). Video is not supported yet (requires the
// separate video service) and is rejected by validation instead of being silently dropped.
// Docs: https://docs.bsky.app/docs/advanced-guides/posts

export const BSKY_LIMITS = { textMax: 300, maxImages: 4, maxImageBytes: 1_000_000, imageMimeTypes: ["image/jpeg", "image/png", "image/webp"] } as const;
const DEFAULT_SERVICE = "https://bsky.social";

export function validateBluesky(input: PublishInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const parts = input.type === "thread" ? splitThread(input.caption) : [input.caption];
  parts.forEach((p, i) => {
    if (graphemes(p) > BSKY_LIMITS.textMax) out.push({ field: "caption", code: "caption_too_long", message: `Teil ${i + 1}: max. ${BSKY_LIMITS.textMax} Zeichen` });
  });
  if (!["text", "image", "carousel", "thread"].includes(input.type)) out.push({ field: "type", code: "type_unsupported", message: input.type === "video" ? "Bluesky-Video wird noch nicht unterstützt" : `Bluesky unterstützt ${input.type} nicht` });
  if (input.media.length > BSKY_LIMITS.maxImages) out.push({ field: "media", code: "too_many_images", message: "Max. 4 Bilder" });
  for (const m of input.media) {
    if (m.kind !== "image" || !BSKY_LIMITS.imageMimeTypes.includes(m.mimeType as never)) out.push({ field: "media", code: "image_format", message: "JPEG/PNG/WebP" });
    else if (m.sizeBytes > BSKY_LIMITS.maxImageBytes) out.push({ field: "media", code: "image_too_large", message: "Max. 1 MB pro Bild" });
  }
  return out;
}

/** Link facets with UTF-8 byte offsets (required by the AT Protocol rich-text model). */
export function linkFacets(text: string) {
  const enc = new TextEncoder();
  const out: { index: { byteStart: number; byteEnd: number }; features: { $type: string; uri: string }[] }[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const uri = m[0].replace(/[.,;:!?)\]]+$/, "");
    const byteStart = enc.encode(text.slice(0, m.index)).byteLength;
    out.push({ index: { byteStart, byteEnd: byteStart + enc.encode(uri).byteLength }, features: [{ $type: "app.bsky.richtext.facet#link", uri }] });
  }
  return out;
}

function jwtExp(jwt: string): Date | undefined {
  try {
    const p = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8")) as { exp?: number };
    return p.exp ? new Date(p.exp * 1000) : undefined;
  } catch {
    return undefined;
  }
}

type Session = { accessJwt: string; refreshJwt: string; did: string; handle: string; didDoc?: { service?: { id: string; serviceEndpoint: string }[] } };
type Blob = { $type: "blob"; ref: { $link: string }; mimeType: string; size: number };
type Direct = { images?: { blob: Blob; alt: string; aspectRatio?: { width: number; height: number } }[] };

export class BlueskyAdapter implements PlatformAdapter {
  readonly platform = "bluesky" as const;
  readonly isMock = false;
  readonly connectMode = "credentials" as const;
  private readonly http: HttpFetch;

  constructor(private readonly opts: { fetch?: HttpFetch; appView?: string } = {}) {
    this.http = opts.fetch ?? fetch;
  }

  getCapabilities() {
    return PLATFORM_CAPABILITIES.bluesky;
  }
  validateContent(input: PublishInput) {
    return validateBluesky(input);
  }

  buildAuthUrl(): string {
    throw new ProviderError("Bluesky is connected with handle + app password", false, "CREDENTIALS_FLOW");
  }
  async exchangeCode(): Promise<ConnectedAccount[]> {
    throw new ProviderError("Bluesky is connected with handle + app password", false, "CREDENTIALS_FLOW");
  }

  private account(s: Session, service: string): ConnectedAccount {
    const pds = s.didDoc?.service?.find((x) => x.id === "#atproto_pds")?.serviceEndpoint ?? service;
    return { externalId: s.did, displayName: `@${s.handle}`, username: s.handle, accessToken: s.accessJwt, refreshToken: s.refreshJwt, tokenExpiresAt: jwtExp(s.accessJwt), grantedScopes: ["app_password"], meta: { pds, handle: s.handle } };
  }

  async connectWithCredentials({ identifier, password, service }: { identifier: string; password: string; service?: string }) {
    if (!/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(password)) throw new ProviderError("Bitte ein App-Passwort verwenden (Format xxxx-xxxx-xxxx-xxxx), nicht das Kontopasswort", false, "APP_PASSWORD_REQUIRED");
    const base = (service ?? DEFAULT_SERVICE).replace(/\/$/, "");
    const s = await call<Session>(this.http, "POST", `${base}/xrpc/com.atproto.server.createSession`, { json: { identifier: identifier.replace(/^@/, ""), password } });
    return [this.account(s, base)];
  }

  async refreshToken(auth: ChannelAuth) {
    if (!auth.refreshToken) throw new ProviderError("missing Bluesky refresh JWT", false, "REAUTH_REQUIRED");
    const s = await call<Session>(this.http, "POST", `${this.pds(auth)}/xrpc/com.atproto.server.refreshSession`, { headers: { authorization: `Bearer ${auth.refreshToken}` } });
    return { accessToken: s.accessJwt, refreshToken: s.refreshJwt, expiresAt: jwtExp(s.accessJwt) };
  }

  async disconnect(auth: ChannelAuth) {
    if (auth.refreshToken) await call(this.http, "POST", `${this.pds(auth)}/xrpc/com.atproto.server.deleteSession`, { headers: { authorization: `Bearer ${auth.refreshToken}` } }).catch(() => {});
  }

  private pds(auth: ChannelAuth) {
    return String(auth.meta.pds ?? DEFAULT_SERVICE).replace(/\/$/, "");
  }

  async createMedia(auth: ChannelAuth, input: PublishInput, log: (l: ProviderCallLog) => void) {
    if (!["text", "image", "carousel", "thread"].includes(input.type)) throw new CapabilityNotSupportedError(`post.${input.type}`);
    const images: NonNullable<Direct["images"]> = [];
    for (const m of input.media) {
      const bytes = await fetchMediaBytes(this.http, m, BSKY_LIMITS.maxImageBytes);
      const r = await call<{ blob: Blob }>(this.http, "POST", `${this.pds(auth)}/xrpc/com.atproto.repo.uploadBlob`, { headers: { authorization: `Bearer ${auth.accessToken}`, "content-type": m.mimeType }, body: bytes as BodyInit, step: "blob.upload", log });
      images.push({ blob: r.blob, alt: "", ...(m.width && m.height ? { aspectRatio: { width: m.width, height: m.height } } : {}) });
    }
    return { containerId: directMarker({ images }) };
  }

  async getPublishStatus(): Promise<ContainerStatus> {
    return "ready";
  }

  /** Exact post records (one per thread part, reply refs filled in at publish time). Exported for contract tests. */
  buildRecords(input: PublishInput, d: Direct, now = new Date()) {
    const parts = input.type === "thread" ? splitThread(input.caption) : [input.caption];
    return parts.map((text, i) => {
      const facets = linkFacets(text);
      return {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date(now.getTime() + i).toISOString(),
        langs: ["de"],
        ...(facets.length ? { facets } : {}),
        ...(i === 0 && d.images?.length ? { embed: { $type: "app.bsky.embed.images", images: d.images.map((x) => ({ alt: x.alt, image: x.blob, ...(x.aspectRatio ? { aspectRatio: x.aspectRatio } : {}) })) } } : {}),
      } as Record<string, unknown>;
    });
  }

  async publish(auth: ChannelAuth, containerId: string, log: (l: ProviderCallLog) => void, input?: PublishInput) {
    if (!input) throw new ProviderError("direct publish needs input", false, "INTERNAL");
    const records = this.buildRecords(input, parseDirect<Direct>(containerId));
    let root: { uri: string; cid: string } | undefined;
    let parent: { uri: string; cid: string } | undefined;
    for (const [i, record] of records.entries()) {
      try {
        const r = await call<{ uri: string; cid: string }>(this.http, "POST", `${this.pds(auth)}/xrpc/com.atproto.repo.createRecord`, {
          headers: { authorization: `Bearer ${auth.accessToken}` },
          json: { repo: auth.externalId, collection: "app.bsky.feed.post", record: { ...record, ...(root && parent ? { reply: { root, parent } } : {}) } },
          step: `record.create.${i}`,
          log,
        });
        root ??= r;
        parent = r;
      } catch (e) {
        if (root) {
          log({ step: "thread.partial", request: { part: i }, response: { error: (e as Error).message }, durationMs: 0 });
          break;
        }
        throw e;
      }
    }
    return { externalPostId: root!.uri };
  }

  async getPostUrl(auth: ChannelAuth, uri: string) {
    const rkey = uri.split("/").pop();
    return `https://bsky.app/profile/${String(auth.meta.handle ?? auth.externalId)}/post/${rkey}`;
  }

  private appView() {
    return (this.opts.appView ?? "https://public.api.bsky.app").replace(/\/$/, "");
  }

  async fetchInsights(_auth: ChannelAuth, uri: string) {
    const r = await call<{ posts: { likeCount?: number; repostCount?: number; replyCount?: number; quoteCount?: number }[] }>(this.http, "GET", `${this.appView()}/xrpc/app.bsky.feed.getPosts`, { query: { uris: uri } });
    const p = r.posts[0];
    // Bluesky exposes no impressions/reach.
    return { likes: p?.likeCount ?? null, comments: p?.replyCount ?? null, shares: p ? (p.repostCount ?? 0) + (p.quoteCount ?? 0) : null, impressions: null };
  }

  async fetchAccountInsights(auth: ChannelAuth) {
    const r = await call<{ followersCount?: number }>(this.http, "GET", `${this.appView()}/xrpc/app.bsky.actor.getProfile`, { query: { actor: auth.externalId } });
    return { followers: r.followersCount ?? null };
  }

  async listComments(_auth: ChannelAuth, uri: string) {
    type Node = { post?: { uri: string; cid: string; record?: { text?: string; createdAt?: string }; author?: { handle?: string } }; replies?: Node[] };
    const r = await call<{ thread: Node }>(this.http, "GET", `${this.appView()}/xrpc/app.bsky.feed.getPostThread`, { query: { uri, depth: 1 } });
    return (r.thread.replies ?? []).filter((n) => n.post).map((n) => ({ id: `${n.post!.uri}|${n.post!.cid}`, text: n.post!.record?.text ?? "", username: n.post!.author?.handle, timestamp: n.post!.record?.createdAt ?? "" }));
  }

  async replyComment(auth: ChannelAuth, commentId: string, text: string) {
    const [uri, cid] = commentId.split("|");
    if (!uri || !cid) throw new ProviderError("unexpected comment id", false, "INVALID_COMMENT_ID");
    const parentRef = { uri, cid };
    // Find the thread root of the comment so the reply is attached correctly.
    const rec = await call<{ value?: { reply?: { root?: { uri: string; cid: string } } } }>(this.http, "GET", `${this.pds(auth)}/xrpc/com.atproto.repo.getRecord`, { query: { repo: uri.split("/")[2], collection: "app.bsky.feed.post", rkey: uri.split("/").pop() } }).catch(() => ({ value: undefined }));
    const root = rec.value?.reply?.root ?? parentRef;
    const facets = linkFacets(text);
    const r = await call<{ uri: string }>(this.http, "POST", `${this.pds(auth)}/xrpc/com.atproto.repo.createRecord`, {
      headers: { authorization: `Bearer ${auth.accessToken}` },
      json: { repo: auth.externalId, collection: "app.bsky.feed.post", record: { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(), reply: { root, parent: parentRef }, ...(facets.length ? { facets } : {}) } },
    });
    return { id: r.uri };
  }

  async listMentions() {
    return [];
  }
}
