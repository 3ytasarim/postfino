import { describe, expect, it } from "vitest";
import {
  LinkedInAdapter,
  InstagramAdapter,
  escapeLittleText,
  TikTokAdapter,
  YouTubeAdapter,
  GoogleBusinessAdapter,
  XAdapter,
  xLength,
  ThreadsAdapter,
  PinterestAdapter,
  BlueskyAdapter,
  linkFacets,
  MastodonAdapter,
  normalizeInstance,
  splitThread,
  ProviderError,
  type PublishInput,
  type ChannelAuth,
} from "@sichttakt/social-adapters";
import { fakeHttp, media, noLog } from "./fake-http";

const input = (o: Partial<PublishInput> = {}): PublishInput => ({ type: "text", caption: "Hallo Welt", media: [], options: {}, ...o });
const auth = (o: Partial<ChannelAuth> = {}): ChannelAuth => ({ accessToken: "AT", externalId: "EXT", meta: {}, ...o });
const bytes = () => ({ bytes: new Uint8Array(1000) });
const MEDIA = /^https:\/\/media\.test\.invalid\//;

describe("helpers", () => {
  it("thread splitting, X length (t.co), little-text escaping, link facets in UTF-8 bytes", () => {
    expect(splitThread("Eins\n---\nZwei\n\n----\nDrei")).toEqual(["Eins", "Zwei", "Drei"]);
    expect(xLength(`Hi ${"https://example.de/" + "a".repeat(100)}`)).toBe(3 + 23);
    expect(escapeLittleText("Sale (50%) #heute @marke")).toBe("Sale \\(50%\\) \\#heute \\@marke");
    const f = linkFacets("Grüße: https://ex.de/ä.");
    const enc = new TextEncoder();
    expect(f[0]!.index.byteStart).toBe(enc.encode("Grüße: ").byteLength);
    expect(f[0]!.features[0]!.uri).toBe("https://ex.de/ä");
    expect(normalizeInstance("https://Mastodon.Social/@marke")).toBe("mastodon.social");
    expect(() => normalizeInstance("localhost")).toThrow();
  });
});

describe("LinkedIn", () => {
  it("profile: auth URL, code exchange → person URN; image upload then post with x-restli-id", async () => {
    const h = fakeHttp([
      ["POST", "https://www.linkedin.com/oauth/v2/accessToken", () => ({ json: { access_token: "LI", expires_in: 5184000, scope: "openid,profile,w_member_social" } })],
      ["GET", "https://api.linkedin.com/v2/userinfo", () => ({ json: { sub: "abc123", name: "Erika Muster" } })],
      ["POST", "https://api.linkedin.com/rest/images", () => ({ json: { value: { uploadUrl: "https://upload.linkedin.test/1", image: "urn:li:image:I1" } } })],
      ["PUT", "https://upload.linkedin.test/", () => ({ status: 201 })],
      ["GET", MEDIA, bytes],
      ["POST", "https://api.linkedin.com/rest/posts", () => ({ status: 201, headers: { "x-restli-id": "urn:li:share:999" } })],
    ]);
    const a = new LinkedInAdapter("linkedin_profile", { clientId: "cid", clientSecret: "sec", version: "202510", fetch: h.fetch });
    const url = new URL(a.buildAuthUrl({ state: "S", redirectUri: "https://api.test/oauth/callback" }));
    expect(url.searchParams.get("scope")).toBe("openid profile w_member_social");
    const [acc] = await a.exchangeCode({ code: "C", redirectUri: "https://api.test/oauth/callback" });
    expect(acc!.meta.author).toBe("urn:li:person:abc123");
    expect(acc!.tokenExpiresAt).toBeInstanceOf(Date);
    const inp = input({ type: "image", caption: "Neu (heute)!", media: [media()] });
    expect(a.validateContent(inp)).toEqual([]);
    const au = auth({ accessToken: "LI", externalId: "abc123", meta: acc!.meta });
    const { containerId } = await a.createMedia(au, inp, noLog);
    expect(await a.getPublishStatus(au, containerId, noLog)).toBe("ready");
    const r = await a.publish(au, containerId, noLog, inp);
    expect(r.externalPostId).toBe("urn:li:share:999");
    const post = h.find("POST", "/rest/posts")[0]!;
    expect(post.headers["linkedin-version"]).toBe("202510");
    expect(post.headers["x-restli-protocol-version"]).toBe("2.0.0");
    expect(post.body).toMatchObject({ author: "urn:li:person:abc123", commentary: "Neu \\(heute\\)!", lifecycleState: "PUBLISHED", content: { media: { id: "urn:li:image:I1" } } });
    expect(await a.getPostUrl(au, r.externalPostId)).toContain("urn:li:share:999");
  });

  it("page: lists administered organisations; refresh without refresh token demands reconnect", async () => {
    const h = fakeHttp([
      ["POST", "https://www.linkedin.com/oauth/v2/accessToken", () => ({ json: { access_token: "LI", expires_in: 100, scope: "w_organization_social" } })],
      ["GET", "https://api.linkedin.com/rest/organizationAcls", () => ({ json: { elements: [{ organization: "urn:li:organization:42", role: "ADMINISTRATOR", state: "APPROVED" }] } })],
      ["GET", "https://api.linkedin.com/rest/organizations/42", () => ({ json: { localizedName: "Café Morgenrot GmbH" } })],
    ]);
    const a = new LinkedInAdapter("linkedin_page", { clientId: "c", clientSecret: "s", version: "202510", fetch: h.fetch });
    const [acc] = await a.exchangeCode({ code: "C", redirectUri: "r" });
    expect(acc).toMatchObject({ externalId: "42", displayName: "Café Morgenrot GmbH", meta: { author: "urn:li:organization:42" } });
    await expect(a.refreshToken(auth())).rejects.toMatchObject({ providerCode: "REAUTH_REQUIRED" });
    expect(a.validateContent(input({ type: "reel" })).map((i) => i.code)).toContain("type_unsupported");
  });
});

describe("TikTok", () => {
  it("requires an explicit privacy level, checks it against creator_info, pulls video from URL", async () => {
    const h = fakeHttp([
      ["POST", "https://open.tiktokapis.com/v2/post/publish/creator_info/query/", () => ({ json: { data: { privacy_level_options: ["SELF_ONLY"], comment_disabled: false, duet_disabled: true, stitch_disabled: true, max_video_post_duration_sec: 600 } } })],
      ["POST", "https://open.tiktokapis.com/v2/post/publish/video/init/", () => ({ json: { data: { publish_id: "p_1" } } })],
      ["POST", "https://open.tiktokapis.com/v2/post/publish/status/fetch/", () => ({ json: { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [] } } })],
    ]);
    const a = new TikTokAdapter({ clientKey: "k", clientSecret: "s", fetch: h.fetch, sleep: async () => {} });
    const v = media({ kind: "video", durationMs: 15_000 });
    expect(a.validateContent(input({ type: "video", video: v })).map((i) => i.code)).toContain("privacy_required");
    const pub = input({ type: "video", video: v, caption: "Neu", options: { privacy: "PUBLIC_TO_EVERYONE" } });
    expect(a.validateContent(pub)).toEqual([]);
    // Unaudited app: only SELF_ONLY is offered → refuse instead of silently changing visibility
    await expect(a.publish(auth(), "direct:", noLog, pub)).rejects.toMatchObject({ providerCode: "PRIVACY_NOT_ALLOWED" });
    expect(h.find("POST", "/video/init/")).toHaveLength(0);
    const ok = await a.publish(auth(), "direct:", noLog, { ...pub, options: { privacy: "SELF_ONLY" } });
    expect(ok.externalPostId).toBe("publish:p_1"); // private post: no public id
    expect(h.find("POST", "/video/init/")[0]!.body).toMatchObject({ post_info: { privacy_level: "SELF_ONLY", disable_duet: true }, source_info: { source: "PULL_FROM_URL", video_url: v.publicUrl } });
    expect(await a.getPostUrl(auth(), ok.externalPostId)).toBeNull();
  });

  it("refresh rotates the refresh token", async () => {
    const h = fakeHttp([["POST", "https://open.tiktokapis.com/v2/oauth/token/", (r) => ({ json: { access_token: "A2", expires_in: 86400, refresh_token: "R2", refresh_expires_in: 1, open_id: "o", scope: "video.publish", got: r.body } })]]);
    const a = new TikTokAdapter({ clientKey: "k", clientSecret: "s", fetch: h.fetch });
    const r = await a.refreshToken(auth({ refreshToken: "R1" }));
    expect(r).toMatchObject({ accessToken: "A2", refreshToken: "R2" });
    expect(h.calls[0]!.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "R1", client_key: "k" });
  });
});

describe("YouTube + Google Business", () => {
  it("YouTube: PKCE auth URL with offline access; resumable upload; independent thumbnail best effort", async () => {
    const h = fakeHttp([
      ["GET", MEDIA, bytes],
      ["POST", "https://www.googleapis.com/upload/youtube/v3/videos", () => ({ status: 200, headers: { location: "https://upload.youtube.test/session/1" } })],
      ["PUT", "https://upload.youtube.test/session/1", () => ({ json: { id: "vid123" } })],
      ["POST", "https://www.googleapis.com/upload/youtube/v3/thumbnails/set", () => ({ status: 403, json: { error: { code: 403, message: "The authenticated user doesn't have permissions to upload and set custom video thumbnails." } } })],
    ]);
    const a = new YouTubeAdapter({ clientId: "g", clientSecret: "s", fetch: h.fetch });
    const u = new URL(a.buildAuthUrl({ state: "S", redirectUri: "r", codeChallenge: "CH" }));
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const inp = input({ type: "short", caption: "Unser Kaffee-Short\nMehr im Laden", video: media({ kind: "video", width: 1080, height: 1920, durationMs: 40_000 }), cover: media(), options: { privacy: "unlisted" } });
    expect(a.validateContent(inp)).toEqual([]);
    const logs: string[] = [];
    const r = await a.publish(auth(), "direct:", (l) => logs.push(l.step), inp);
    expect(r.externalPostId).toBe("vid123");
    expect(h.find("POST", "/upload/youtube/v3/videos")[0]!.body).toMatchObject({ snippet: { title: "Unser Kaffee-Short" }, status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false } });
    expect(logs).toContain("thumbnail.set"); // failure logged, upload still succeeds
    expect(a.validateContent({ ...inp, video: media({ kind: "video", width: 1920, height: 1080, durationMs: 40_000 }) }).map((i) => i.code)).toContain("short_orientation");
    expect(a.validateContent({ ...inp, caption: "", options: {} }).map((i) => i.code)).toContain("title_required");
  });

  it("Google Business: one channel per location, local post with call-to-action, phone numbers rejected", async () => {
    const h = fakeHttp([
      ["POST", "https://oauth2.googleapis.com/token", () => ({ json: { access_token: "G", expires_in: 3599, refresh_token: "GR", scope: "https://www.googleapis.com/auth/business.manage" } })],
      ["GET", "https://mybusinessaccountmanagement.googleapis.com/v1/accounts", () => ({ json: { accounts: [{ name: "accounts/1" }] } })],
      ["GET", "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/1/locations", () => ({ json: { locations: [{ name: "locations/7", title: "Filiale Mitte" }, { name: "locations/8", title: "Filiale Nord" }] } })],
      ["POST", "https://mybusiness.googleapis.com/v4/accounts/1/locations/7/localPosts", () => ({ json: { name: "accounts/1/locations/7/localPosts/p1" } })],
    ]);
    const a = new GoogleBusinessAdapter({ clientId: "g", clientSecret: "s", fetch: h.fetch });
    const accs = await a.exchangeCode({ code: "C", redirectUri: "r", codeVerifier: "V" });
    expect(accs.map((x) => x.externalId)).toEqual(["accounts/1/locations/7", "accounts/1/locations/8"]);
    expect(accs[0]!.refreshToken).toBe("GR");
    expect(h.find("POST", "oauth2.googleapis.com/token")[0]!.body).toMatchObject({ code_verifier: "V" });
    const inp = input({ caption: "Herbstangebot im Laden", options: { link: "https://cafe.example.de" } });
    const r = await a.publish(auth({ externalId: "accounts/1/locations/7" }), "direct:", noLog, inp);
    expect(r.externalPostId).toBe("accounts/1/locations/7/localPosts/p1");
    expect(h.find("POST", "localPosts")[0]!.body).toMatchObject({ topicType: "STANDARD", callToAction: { actionType: "LEARN_MORE", url: "https://cafe.example.de" } });
    expect(a.validateContent(input({ caption: "Ruf an: 030 1234 5678" })).map((i) => i.code)).toContain("phone_in_text");
  });
});

describe("X", () => {
  it("PKCE is mandatory; images uploaded first; threads become a reply chain; partial thread is not re-sent", async () => {
    let n = 0;
    const h = fakeHttp([
      ["GET", MEDIA, bytes],
      ["POST", "https://api.x.com/2/media/upload", () => ({ json: { data: { id: "m1" } } })],
      ["GET", "https://api.x.com/2/media/upload", () => ({ json: { data: { processing_info: { state: "succeeded" } } } })],
      ["POST", "https://api.x.com/2/tweets", () => (++n === 3 ? { status: 503, json: { title: "Service Unavailable", detail: "busy" } } : { json: { data: { id: `t${n}` } } })],
    ]);
    const a = new XAdapter({ clientId: "x", clientSecret: "s", fetch: h.fetch });
    expect(() => a.buildAuthUrl({ state: "S", redirectUri: "r" })).toThrow(ProviderError);
    expect(new URL(a.buildAuthUrl({ state: "S", redirectUri: "r", codeChallenge: "C" })).searchParams.get("scope")).toContain("offline.access");
    const inp = input({ type: "thread", caption: "Teil eins\n---\nTeil zwei\n---\nTeil drei", media: [media()] });
    expect(a.validateContent(inp)).toEqual([]);
    const { containerId } = await a.createMedia(auth(), inp, noLog);
    expect(await a.getPublishStatus(auth(), containerId, noLog)).toBe("ready");
    const logs: string[] = [];
    const r = await a.publish(auth(), containerId, (l) => logs.push(l.step), inp);
    expect(r.externalPostId).toBe("t1");
    const tweets = h.find("POST", "/2/tweets");
    expect(tweets[0]!.body).toMatchObject({ text: "Teil eins", media: { media_ids: ["m1"] } });
    expect(tweets[1]!.body).toMatchObject({ text: "Teil zwei", reply: { in_reply_to_tweet_id: "t1" } });
    expect(logs).toContain("thread.partial");
    expect(a.validateContent(input({ caption: "x".repeat(281) })).map((i) => i.code)).toContain("caption_too_long");
  });
});

describe("Threads", () => {
  it("container → FINISHED → threads_publish; long-lived token on connect", async () => {
    const h = fakeHttp([
      ["POST", "https://graph.threads.net/oauth/access_token", () => ({ json: { access_token: "short", user_id: 5 } })],
      ["GET", "https://graph.threads.net/access_token", (r) => ({ json: { access_token: "long", expires_in: 5183944, q: r.url } })],
      ["GET", "https://graph.threads.net/v1.0/me", () => ({ json: { id: "5", username: "marke" } })],
      ["POST", "https://graph.threads.net/v1.0/5/threads_publish", () => ({ json: { id: "post9" } })],
      ["POST", "https://graph.threads.net/v1.0/5/threads", () => ({ json: { id: "c1" } })],
      ["GET", "https://graph.threads.net/v1.0/c1", () => ({ json: { status: "FINISHED" } })],
    ]);
    const a = new ThreadsAdapter({ appId: "a", appSecret: "s", fetch: h.fetch });
    const [acc] = await a.exchangeCode({ code: "C", redirectUri: "r" });
    expect(acc).toMatchObject({ externalId: "5", accessToken: "long" });
    expect(h.find("GET", "access_token")[0]!.url).toContain("grant_type=th_exchange_token");
    const inp = input({ type: "image", caption: "Hallo", media: [media()] });
    const au = auth({ externalId: "5" });
    const { containerId } = await a.createMedia(au, inp, noLog);
    expect(h.find("POST", "/5/threads")[0]!.url).toContain("media_type=IMAGE");
    expect(await a.getPublishStatus(au, containerId, noLog)).toBe("ready");
    expect((await a.publish(au, containerId, noLog, inp)).externalPostId).toBe("post9");
    expect(a.validateContent(input({ caption: "x".repeat(501) })).map((i) => i.code)).toContain("caption_too_long");
  });
});

describe("Pinterest", () => {
  it("one channel per board; video pin needs an independent cover; status polling", async () => {
    const h = fakeHttp([
      ["POST", "https://api.pinterest.com/v5/oauth/token", (r) => ({ json: { access_token: "P", refresh_token: "PR", expires_in: 2592000, scope: "boards:read,pins:write", auth: r.headers.authorization } })],
      ["GET", "https://api.pinterest.com/v5/user_account", () => ({ json: { username: "cafemorgenrot" } })],
      ["GET", "https://api.pinterest.com/v5/boards", () => ({ json: { items: [{ id: "b1", name: "Kuchen" }, { id: "b2", name: "Kaffee" }] } })],
      ["POST", "https://api.pinterest.com/v5/media", () => ({ json: { media_id: "md1", upload_url: "https://pinterest-media-upload.test/", upload_parameters: { key: "k1", policy: "p" } } })],
      ["POST", "https://pinterest-media-upload.test/", () => ({ status: 204 })],
      ["GET", MEDIA, bytes],
      ["GET", "https://api.pinterest.com/v5/media/md1", () => ({ json: { status: "succeeded" } })],
      ["POST", "https://api.pinterest.com/v5/pins", () => ({ json: { id: "pin77" } })],
    ]);
    const a = new PinterestAdapter({ appId: "a", appSecret: "s", fetch: h.fetch });
    const accs = await a.exchangeCode({ code: "C", redirectUri: "r" });
    expect(accs.map((x) => [x.externalId, x.displayName])).toEqual([["b1", "cafemorgenrot / Kuchen"], ["b2", "cafemorgenrot / Kaffee"]]);
    expect(h.calls[0]!.headers.authorization).toMatch(/^Basic /);
    const v = media({ kind: "video", durationMs: 20_000 });
    expect(a.validateContent(input({ type: "video", video: v })).map((i) => i.code)).toContain("cover_required");
    const inp = input({ type: "video", caption: "Käsekuchen-Rezept", video: v, cover: media(), options: { link: "https://shop.example.de/kuchen" } });
    expect(a.validateContent(inp)).toEqual([]);
    const au = auth({ externalId: "b1" });
    const { containerId } = await a.createMedia(au, inp, noLog);
    expect(h.find("POST", "pinterest-media-upload")[0]!.body).toMatchObject({ key: "k1", policy: "p" });
    expect(await a.getPublishStatus(au, containerId, noLog)).toBe("ready");
    await a.publish(au, containerId, noLog, inp);
    expect(h.find("POST", "/v5/pins")[0]!.body).toMatchObject({ board_id: "b1", link: "https://shop.example.de/kuchen", media_source: { source_type: "video_id", media_id: "md1", cover_image_url: inp.cover!.publicUrl } });
  });
});

describe("Bluesky", () => {
  it("app password only (never the account password); blobs + facets; session refresh rotates", async () => {
    const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.y`;
    const h = fakeHttp([
      ["POST", "https://bsky.social/xrpc/com.atproto.server.createSession", () => ({ json: { accessJwt: jwt(2_000_000_000), refreshJwt: "R1", did: "did:plc:abc", handle: "marke.bsky.social", didDoc: { service: [{ id: "#atproto_pds", serviceEndpoint: "https://pds.example.host" }] } } })],
      ["GET", MEDIA, bytes],
      ["POST", "https://pds.example.host/xrpc/com.atproto.repo.uploadBlob", () => ({ json: { blob: { $type: "blob", ref: { $link: "bafy1" }, mimeType: "image/jpeg", size: 1000 } } })],
      ["POST", "https://pds.example.host/xrpc/com.atproto.repo.createRecord", () => ({ json: { uri: "at://did:plc:abc/app.bsky.feed.post/3k1", cid: "cid1" } })],
      ["POST", "https://pds.example.host/xrpc/com.atproto.server.refreshSession", () => ({ json: { accessJwt: jwt(2_000_000_100), refreshJwt: "R2", did: "did:plc:abc", handle: "marke.bsky.social" } })],
    ]);
    const a = new BlueskyAdapter({ fetch: h.fetch });
    await expect(a.connectWithCredentials!({ identifier: "marke.bsky.social", password: "mein-geheimes-Passwort" })).rejects.toMatchObject({ providerCode: "APP_PASSWORD_REQUIRED" });
    expect(h.calls).toHaveLength(0);
    const [acc] = await a.connectWithCredentials!({ identifier: "@marke.bsky.social", password: "abcd-efgh-ijkl-mnop" });
    expect(acc).toMatchObject({ externalId: "did:plc:abc", refreshToken: "R1", meta: { pds: "https://pds.example.host" } });
    expect(JSON.stringify(acc)).not.toContain("abcd-efgh-ijkl-mnop");
    expect(acc!.tokenExpiresAt!.getTime()).toBe(2_000_000_000_000);
    const au = auth({ externalId: acc!.externalId, meta: acc!.meta, refreshToken: "R1" });
    const inp = input({ type: "image", caption: "Neu: https://cafe.example.de", media: [media({ width: 800, height: 600 })] });
    const { containerId } = await a.createMedia(au, inp, noLog);
    const r = await a.publish(au, containerId, noLog, inp);
    expect(r.externalPostId).toBe("at://did:plc:abc/app.bsky.feed.post/3k1");
    const rec = h.find("POST", "createRecord")[0]!.body as { repo: string; record: { facets: unknown[]; embed: { images: { image: { ref: { $link: string } }; aspectRatio: unknown }[] } } };
    expect(rec.repo).toBe("did:plc:abc");
    expect(rec.record.facets).toHaveLength(1);
    expect(rec.record.embed.images[0]).toMatchObject({ image: { ref: { $link: "bafy1" } }, aspectRatio: { width: 800, height: 600 } });
    expect(await a.getPostUrl(au, r.externalPostId)).toBe("https://bsky.app/profile/marke.bsky.social/post/3k1");
    expect((await a.refreshToken(au)).refreshToken).toBe("R2");
    expect(a.validateContent(input({ type: "video", video: media({ kind: "video" }) })).map((i) => i.code)).toContain("type_unsupported");
    expect(a.validateContent(input({ media: [media({ sizeBytes: 2_000_000 })], type: "image" })).map((i) => i.code)).toContain("image_too_large");
  });
});

describe("Mastodon", () => {
  it("registers one app per instance, reuses it, SSRF-checks the host and posts with an Idempotency-Key", async () => {
    const saved = new Map<string, { clientId: string; clientSecret: string }>();
    const checked: string[] = [];
    const h = fakeHttp([
      ["POST", "https://social.example.org/api/v1/apps", () => ({ json: { client_id: "cid", client_secret: "csec" } })],
      ["POST", "https://social.example.org/oauth/token", () => ({ json: { access_token: "MT", scope: "read write:statuses write:media" } })],
      ["GET", "https://social.example.org/api/v1/accounts/verify_credentials", () => ({ json: { id: "1", username: "marke", acct: "marke" } })],
      ["GET", "https://social.example.org/api/v2/instance", () => ({ json: { configuration: { statuses: { max_characters: 1000 } } } })],
      ["POST", "https://social.example.org/api/v1/statuses", (r) => ({ json: { id: `s-${r.headers["idempotency-key"]}` } })],
    ]);
    const a = new MastodonAdapter({
      store: { get: async (i, r) => saved.get(`${i}|${r}`) ?? null, save: async (i, r, app) => void saved.set(`${i}|${r}`, app) },
      appName: "SichtTakt",
      website: "https://app.test",
      assertPublicHost: async (host) => {
        checked.push(host);
        if (host.endsWith(".internal")) throw new Error("private");
      },
      fetch: h.fetch,
    });
    const u1 = await a.buildAuthUrl({ state: "S1", redirectUri: "https://api.test/cb", instance: "https://Social.Example.org" });
    await a.buildAuthUrl({ state: "S2", redirectUri: "https://api.test/cb", instance: "social.example.org" });
    expect(h.find("POST", "/api/v1/apps")).toHaveLength(1); // reused
    expect(new URL(u1).host).toBe("social.example.org");
    await expect(a.buildAuthUrl({ state: "S", redirectUri: "r", instance: "evil.internal" })).rejects.toThrow("private");
    expect(checked).toContain("evil.internal");
    const [acc] = await a.exchangeCode({ code: "C", redirectUri: "https://api.test/cb", instance: "social.example.org" });
    expect(acc).toMatchObject({ username: "marke@social.example.org", meta: { instance: "social.example.org", maxCharacters: 1000 } });
    const au = auth({ accessToken: "MT", meta: acc!.meta });
    const inp = input({ type: "thread", caption: "A\n---\nB" });
    const r = await a.publish(au, "direct:{}", noLog, inp);
    const sts = h.find("POST", "/api/v1/statuses");
    expect(sts).toHaveLength(2);
    expect(sts[0]!.headers["idempotency-key"]).toBeTruthy();
    expect(sts[1]!.body).toMatchObject({ status: "B", in_reply_to_id: r.externalPostId });
  });
});

describe("Instagram API with Unified Login", () => {
  const G = "https://graph.facebook.com/v27.0";
  it("documented dialog (config_id, no scope, prompt=login) and accounts from /me/assigned_instagram_accounts", async () => {
    const h = fakeHttp([
      ["GET", `${G}/oauth/access_token`, () => ({ json: { access_token: "SUAT" } })],
      ["GET", `${G}/me?`, () => ({ json: { id: "SU1", client_business_id: "CB9" } })],
      ["GET", `${G}/me/assigned_instagram_accounts`, (r) => (r.url.includes("after=") ? { json: { data: [{ id: "IG2", username: "zweiter" }] } } : { json: { data: [{ id: "IG1", username: "3ytasarim" }], paging: { cursors: { after: "A1" }, next: "https://next" } } })],
      ["GET", `${G}/debug_token`, () => ({ json: { data: { scopes: ["instagram_basic", "instagram_content_publish", "business_management"], expires_at: 0 } } })],
      ["GET", `${G}/IG1`, () => ({ json: { id: "IG1", username: "3ytasarim", name: "3Y Tasarım", profile_picture_url: "https://cdn.test/a.jpg" } })],
      ["GET", `${G}/IG2`, () => ({ status: 400, json: { error: { message: "nope", code: 100 } } })],
    ]);
    const a = new InstagramAdapter({ appId: "APP", appSecret: "SEC", graphVersion: "v27.0", configId: "CFG9", fetch: h.fetch });
    const url = new URL(a.buildAuthUrl({ state: "S", redirectUri: "https://api.test/oauth/callback" }));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v27.0/dialog/oauth");
    expect(url.searchParams.get("config_id")).toBe("CFG9");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.get("scope")).toBeNull();

    const accs = await a.exchangeCode({ code: "C", redirectUri: "https://api.test/oauth/callback" });
    expect(accs.map((x) => [x.externalId, x.username])).toEqual([["IG1", "3ytasarim"], ["IG2", "zweiter"]]);
    expect(accs[0]).toMatchObject({ displayName: "3Y Tasarım", accessToken: "SUAT", tokenExpiresAt: undefined, meta: { loginFlow: "unified_login", clientBusinessId: "CB9", systemUserId: "SU1" } });
    expect(accs[0]!.grantedScopes).toContain("business_management");
    // no legacy calls in this flow
    expect(h.find("GET", "/me/accounts")).toHaveLength(0);
    expect(h.find("GET", "grant_type=fb_exchange_token")).toHaveLength(0);
  });

  it("explains the usual cause when Meta returns no Instagram account", async () => {
    const h = fakeHttp([
      ["GET", `${G}/oauth/access_token`, () => ({ json: { access_token: "SUAT" } })],
      ["GET", `${G}/me?`, () => ({ json: { id: "SU1" } })],
      ["GET", `${G}/me/assigned_instagram_accounts`, () => ({ json: { data: [] } })],
    ]);
    const a = new InstagramAdapter({ appId: "APP", appSecret: "SEC", graphVersion: "v27.0", configId: "CFG9", fetch: h.fetch });
    await expect(a.exchangeCode({ code: "C", redirectUri: "r" })).rejects.toMatchObject({ providerCode: "NO_INSTAGRAM_ASSETS" });
  });
});
