import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, schema } from "@sichttakt/db";
import { getConfig } from "@sichttakt/config";
import {
  AdapterRegistry,
  beginConnect,
  completeConnect,
  connectWithCredentials,
  dbMastodonStore,
  isPlatformConfigured,
  createPost,
  getPost,
  claimJobs,
  processPublishJob,
  processRefreshJob,
  enqueue,
  decrypt,
  type PublisherDeps,
} from "@sichttakt/core";
import { XAdapter, MastodonAdapter, BlueskyAdapter, type PlatformAdapter } from "@sichttakt/social-adapters";
import { createApiApp } from "@sichttakt/api";
import { createTestServices, createTenant, inMinutes } from "./helpers";
import { fakeHttp } from "./fake-http";

let svc: Awaited<ReturnType<typeof createTestServices>>;
beforeAll(async () => {
  svc = await createTestServices();
});
afterAll(() => svc.close());

const REDIRECT = "http://localhost:3611/oauth/callback";

function xFake() {
  let token = 0;
  return fakeHttp([
    ["POST", "https://api.x.com/2/oauth2/token", (r) => {
      token++;
      return { json: { access_token: `xa${token}`, refresh_token: `xr${token}`, expires_in: 7200, scope: "tweet.write offline.access", sent: r.body } };
    }],
    ["GET", "https://api.x.com/2/users/me", () => ({ json: { data: { id: "u1", name: "Café Morgenrot", username: "cafemorgenrot" } } })],
    ["POST", "https://api.x.com/2/tweets", (r) => ({ json: { data: { id: `tw-${r.headers.authorization}` } } })],
  ]);
}

describe("platform configuration", () => {
  it("platforms without developer app keys are not configured and never called", async () => {
    const cfg = getConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(isPlatformConfigured(cfg, "linkedin_page")).toBe(false);
    expect(isPlatformConfigured(cfg, "bluesky")).toBe(true);
    expect(isPlatformConfigured(cfg, "mastodon")).toBe(true);
    expect(isPlatformConfigured(getConfig({ NODE_ENV: "test", X_CLIENT_ID: "a", X_CLIENT_SECRET: "b" } as NodeJS.ProcessEnv), "x")).toBe(true);
    const t = await createTenant(svc);
    for (const p of ["linkedin_page", "tiktok", "youtube", "x", "threads", "pinterest", "google_business"] as const)
      await expect(beginConnect(svc.db, svc.registry, t.actor, { workspaceId: t.workspace.id, platform: p, redirectUri: REDIRECT })).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
    await expect(beginConnect(svc.db, svc.registry, t.actor, { workspaceId: t.workspace.id, platform: "substack", redirectUri: REDIRECT })).rejects.toMatchObject({ code: "VALIDATION_FAILED", message: "no_publishing_api_create_reminder_channel" });
  });
});

describe("OAuth with PKCE (X)", () => {
  it("challenge = S256(stored verifier); verifier sent on exchange; refresh token stored encrypted", async () => {
    const t = await createTenant(svc);
    const h = xFake();
    const registry = new AdapterRegistry(svc.config, { x: new XAdapter({ clientId: "cid", clientSecret: "sec", fetch: h.fetch }) as PlatformAdapter });
    const { url } = await beginConnect(svc.db, registry, t.actor, { workspaceId: t.workspace.id, platform: "x", redirectUri: REDIRECT });
    const u = new URL(url);
    const state = u.searchParams.get("state")!;
    const [st] = await svc.db.select().from(schema.oauthStates).where(eq(schema.oauthStates.workspaceId, t.workspace.id));
    expect(st!.codeVerifier).toBeTruthy();
    expect(u.searchParams.get("code_challenge")).toBe(createHash("sha256").update(st!.codeVerifier!).digest("base64url"));
    const { channels } = await completeConnect(svc.db, svc.ring, registry, { state, code: "CODE", redirectUri: REDIRECT });
    expect(h.find("POST", "/oauth2/token")[0]!.body).toMatchObject({ code_verifier: st!.codeVerifier, grant_type: "authorization_code" });
    const [cred] = await svc.db.select().from(schema.channelCredentials).where(eq(schema.channelCredentials.channelId, channels[0]!.id));
    expect(cred!.refreshTokenEnc).toBeTruthy();
    expect(cred!.refreshTokenEnc).not.toContain("xr1");
    expect(decrypt(svc.ring, cred!.refreshTokenEnc!)).toBe("xr1");
    // state is single-use
    await expect(completeConnect(svc.db, svc.ring, registry, { state, code: "CODE", redirectUri: REDIRECT })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("expired short-lived token is refreshed right before publishing; rotated refresh token is persisted", async () => {
    const t = await createTenant(svc);
    const h = xFake();
    const registry = new AdapterRegistry(svc.config, { x: new XAdapter({ clientId: "cid", clientSecret: "sec", fetch: h.fetch }) as PlatformAdapter });
    const { url } = await beginConnect(svc.db, registry, t.actor, { workspaceId: t.workspace.id, platform: "x", redirectUri: REDIRECT });
    const { channels } = await completeConnect(svc.db, svc.ring, registry, { state: new URL(url).searchParams.get("state")!, code: "C", redirectUri: REDIRECT });
    const ch = channels[0]!;
    await svc.db.update(schema.channelCredentials).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(schema.channelCredentials.channelId, ch.id));
    const { post } = await createPost(svc.db, registry, t.actor, { workspace_id: t.workspace.id, account_ids: [ch.id], type: "text", caption: "Frisch gebacken!", media_asset_ids: [], status: "scheduled", scheduled_at: inMinutes(5).toISOString(), publish_mode: "automatic" } as never);
    const deps: PublisherDeps = { db: svc.db, ring: svc.ring, registry, storage: svc.storage, mediaUrlTtlSeconds: 600, pollIntervalMs: 0, sleep: async () => {} };
    const at = inMinutes(6);
    const jobs = (await claimJobs(svc.db, "w", { now: at, kinds: ["publish_target"], limit: 100 })).filter((j) => j.organizationId === t.organization.id);
    expect(await processPublishJob({ ...deps, now: () => at }, jobs[0]!)).toBe("published");
    expect(h.find("POST", "/oauth2/token")[1]!.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "xr1" });
    expect(h.find("POST", "/2/tweets")[0]!.headers.authorization).toBe("Bearer xa2"); // fresh token used
    const [cred] = await svc.db.select().from(schema.channelCredentials).where(eq(schema.channelCredentials.channelId, ch.id));
    expect(decrypt(svc.ring, cred!.refreshTokenEnc!)).toBe("xr2");
    expect(cred!.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect((await getPost(svc.db, t.actor, post.id)).targets[0]!.status).toBe("PUBLISHED");

    // background refresh job uses + rotates the stored refresh token as well
    const job = await enqueue(svc.db, { kind: "refresh_token", organizationId: t.organization.id, payload: { channelId: ch.id }, dedupKey: `t-${ch.id}` });
    const [claimed] = (await claimJobs(svc.db, "w", { kinds: ["refresh_token"], limit: 50 })).filter((j) => j.id === job.id);
    expect(await processRefreshJob({ db: svc.db, ring: svc.ring, registry }, claimed!)).toBe("refreshed");
    const [cred2] = await svc.db.select().from(schema.channelCredentials).where(eq(schema.channelCredentials.channelId, ch.id));
    expect(decrypt(svc.ring, cred2!.refreshTokenEnc!)).toBe("xr3");
  });
});

describe("Mastodon (instance OAuth)", () => {
  it("stores the instance on the state, registers the app once, secret encrypted", async () => {
    const t = await createTenant(svc);
    const h = fakeHttp([
      ["POST", "https://chaos.example.social/api/v1/apps", () => ({ json: { client_id: "mc", client_secret: "m-secret-123" } })],
      ["POST", "https://chaos.example.social/oauth/token", () => ({ json: { access_token: "MT", scope: "read write:statuses write:media" } })],
      ["GET", "https://chaos.example.social/api/v1/accounts/verify_credentials", () => ({ json: { id: "9", username: "marke", acct: "marke" } })],
      ["GET", "https://chaos.example.social/api/v2/instance", () => ({ json: {} })],
    ]);
    const masto = new MastodonAdapter({ store: dbMastodonStore(svc.db, svc.ring), appName: "SichtTakt", website: "http://localhost:3610", assertPublicHost: async () => {}, fetch: h.fetch });
    const registry = new AdapterRegistry(svc.config, { mastodon: masto as PlatformAdapter });
    await expect(beginConnect(svc.db, registry, t.actor, { workspaceId: t.workspace.id, platform: "mastodon", redirectUri: REDIRECT })).rejects.toMatchObject({ message: "instance_required" });
    const { url } = await beginConnect(svc.db, registry, t.actor, { workspaceId: t.workspace.id, platform: "mastodon", redirectUri: REDIRECT, instance: "chaos.example.social" });
    await beginConnect(svc.db, registry, t.actor, { workspaceId: t.workspace.id, platform: "mastodon", redirectUri: REDIRECT, instance: "CHAOS.example.social" });
    expect(h.find("POST", "/api/v1/apps")).toHaveLength(1);
    const [app] = await svc.db.select().from(schema.oauthClientApps).where(eq(schema.oauthClientApps.instance, "chaos.example.social"));
    expect(app!.clientSecretEnc).not.toContain("m-secret-123");
    const { channels } = await completeConnect(svc.db, svc.ring, registry, { state: new URL(url).searchParams.get("state")!, code: "C", redirectUri: REDIRECT });
    expect(channels[0]).toMatchObject({ platform: "mastodon", username: "marke@chaos.example.social" });
    expect(h.find("POST", "/oauth/token")[0]!.body).toMatchObject({ client_secret: "m-secret-123" });
  });

  it("the real registry refuses private instance hosts (SSRF)", async () => {
    const t = await createTenant(svc);
    const prodLike = new AdapterRegistry(getConfig({ NODE_ENV: "production", ENCRYPTION_KEYS: "v1:" + Buffer.alloc(32, 1).toString("base64"), SESSION_SECRET: "x".repeat(40) } as NodeJS.ProcessEnv), {}, { db: svc.db, ring: svc.ring });
    await expect(beginConnect(svc.db, prodLike, t.actor, { workspaceId: t.workspace.id, platform: "mastodon", redirectUri: REDIRECT, instance: "localhost.localdomain" })).rejects.toBeTruthy();
  });
});

describe("Bluesky (credentials)", () => {
  it("connects with an app password that is never persisted anywhere", async () => {
    const t = await createTenant(svc);
    const pw = "abcd-efgh-ijkl-mnop";
    const h = fakeHttp([["POST", "https://bsky.social/xrpc/com.atproto.server.createSession", () => ({ json: { accessJwt: "a.e30.b", refreshJwt: "REFRESH", did: "did:plc:xyz", handle: "marke.bsky.social" } })]]);
    const registry = new AdapterRegistry(svc.config, { bluesky: new BlueskyAdapter({ fetch: h.fetch }) as PlatformAdapter });
    await expect(beginConnect(svc.db, registry, t.actor, { workspaceId: t.workspace.id, platform: "bluesky", redirectUri: REDIRECT })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const [ch] = await connectWithCredentials(svc.db, svc.ring, registry, t.actor, { workspaceId: t.workspace.id, platform: "bluesky", identifier: "marke.bsky.social", password: pw });
    expect(ch).toMatchObject({ platform: "bluesky", username: "marke.bsky.social" });
    const dump = JSON.stringify([
      await svc.db.select().from(schema.channels).where(eq(schema.channels.workspaceId, t.workspace.id)),
      await svc.db.select().from(schema.channelCredentials).where(eq(schema.channelCredentials.organizationId, t.organization.id)),
      await svc.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.organizationId, t.organization.id)),
    ]);
    expect(dump).not.toContain(pw);
    await expect(connectWithCredentials(svc.db, svc.ring, registry, t.actor, { workspaceId: t.workspace.id, platform: "bluesky", identifier: "x", password: "kein-app-passwort" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("OAuth callback", () => {
  it("redirects back to the app with a readable error instead of JSON", async () => {
    const app = createApiApp(svc, {});
    const r1 = await app.request("/oauth/callback?error=access_denied&error_description=Der%20Nutzer%20hat%20abgebrochen");
    expect(r1.status).toBe(302);
    expect(new URL(r1.headers.get("location")!).searchParams.get("error")).toBe("Der Nutzer hat abgebrochen");
    const r2 = await app.request("/oauth/callback?state=unknown&code=x");
    expect(r2.status).toBe(302);
    expect(r2.headers.get("location")).toContain("error=invalid_or_expired_oauth_state");
  });
});
