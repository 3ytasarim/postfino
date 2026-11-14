import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, schema } from "@sichttakt/db";
import {
  getOrCreateStartPage,
  updateStartPage,
  addBlock,
  updateBlock,
  listBlocks,
  addGridItem,
  publishStartPage,
  revertStartPageDraft,
  unpublishStartPage,
  getPublishedPage,
  resolveClickTarget,
  snapshotHasAsset,
  recordLinkEvent,
  startPageStats,
  deviceClass,
  createShortLink,
  resolveShortLink,
  disableShortLink,
  shortenLinksInText,
  listIntegrations,
  connectBitly,
  bitlyShorten,
  unsplashSearch,
  recordHeartbeat,
  systemStatus,
  createApiKey,
} from "@sichttakt/core";
import { createApiApp } from "@sichttakt/api";
import { SichtTakt, SichtTaktError, verifyWebhook } from "../sdks/typescript/src/index";
import { createTestServices, createTenant, uploadAsset } from "./helpers";
import { jpeg } from "./fixtures";

let svc: Awaited<ReturnType<typeof createTestServices>>;
beforeAll(async () => {
  svc = await createTestServices();
});
afterAll(() => svc.close());

const fakeFetch = (handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const r = handler(String(input instanceof Request ? input.url : input), init);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

describe("Start Page + Shop Grid", () => {
  it("draft edits stay private until publish; revert restores the published snapshot", async () => {
    const t = await createTenant(svc);
    const page = await getOrCreateStartPage(svc.db, t.actor, t.workspace.id);
    expect(page.slug).toMatch(/^[a-z0-9-]+$/);
    expect(await getPublishedPage(svc.db, page.slug)).toBeNull(); // nothing public before publish

    const btn = await addBlock(svc.db, t.actor, page.id, "button", { label: "Shop", url: "https://shop.example.de" });
    await addBlock(svc.db, t.actor, page.id, "social_links", { links: [{ network: "instagram", url: "https://instagram.com/marke" }, { network: "email", url: "hallo@marke.de" }] });
    const snap1 = await publishStartPage(svc.db, t.actor, page.id);
    expect(snap1.version).toBe(1);

    // Draft change → public page unchanged
    await updateBlock(svc.db, t.actor, btn.id, { label: "Neuer Shop", url: "https://neu.example.de" });
    await addBlock(svc.db, t.actor, page.id, "text", { text: "Nur im Entwurf" });
    const pub = await getPublishedPage(svc.db, page.slug);
    expect(pub!.snapshot.blocks).toHaveLength(2);
    expect(resolveClickTarget(pub!.snapshot, btn.id)).toBe("https://shop.example.de");

    await revertStartPageDraft(svc.db, t.actor, page.id);
    const blocks = await listBlocks(svc.db, page.id);
    expect(blocks).toHaveLength(2);
    expect((blocks[0]!.data as { url: string }).url).toBe("https://shop.example.de");

    await unpublishStartPage(svc.db, t.actor, page.id);
    expect(await getPublishedPage(svc.db, page.slug)).toBeNull();
  });

  it("click targets resolve only from the snapshot (no open redirect) and reject non-http URLs", async () => {
    const t = await createTenant(svc);
    const page = await getOrCreateStartPage(svc.db, t.actor, t.workspace.id);
    await expect(addBlock(svc.db, t.actor, page.id, "button", { label: "x", url: "javascript:alert(1)" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const social = await addBlock(svc.db, t.actor, page.id, "social_links", { links: [{ network: "website", url: "ftp://evil" }, { network: "email", url: "a@b.de" }] });
    const snap = await publishStartPage(svc.db, t.actor, page.id);
    expect(resolveClickTarget(snap, social.id, 0)).toBeNull(); // non-http website link is never redirected
    expect(resolveClickTarget(snap, social.id, 1)).toBe("mailto:a@b.de");
    expect(resolveClickTarget(snap, crypto.randomUUID())).toBeNull();
    expect(resolveClickTarget(snap, social.id, 9)).toBeNull();
  });

  it("slug rules, reserved words, uniqueness; cross-tenant access is 404", async () => {
    const a = await createTenant(svc);
    const b = await createTenant(svc);
    const pa = await getOrCreateStartPage(svc.db, a.actor, a.workspace.id);
    const pb = await getOrCreateStartPage(svc.db, b.actor, b.workspace.id);
    await expect(updateStartPage(svc.db, a.actor, pa.id, { slug: "admin" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(updateStartPage(svc.db, a.actor, pa.id, { slug: "Ungültig!" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await updateStartPage(svc.db, a.actor, pa.id, { slug: `marke-a-${Date.now()}` });
    const taken = (await updateStartPage(svc.db, a.actor, pa.id, {})).slug;
    await expect(updateStartPage(svc.db, b.actor, pb.id, { slug: taken })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(addBlock(svc.db, b.actor, pa.id, "text", { text: "fremd" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("shop grid tiles + media guard: only snapshot assets are public; one shop grid per page", async () => {
    const t = await createTenant(svc);
    const page = await getOrCreateStartPage(svc.db, t.actor, t.workspace.id);
    const img = await uploadAsset(svc, t.actor, t.workspace.id, "image");
    const other = await uploadAsset(svc, t.actor, t.workspace.id, "image");
    await addBlock(svc.db, t.actor, page.id, "shop_grid", { title: "Shop" });
    await expect(addBlock(svc.db, t.actor, page.id, "shop_grid", {})).rejects.toMatchObject({ code: "CONFLICT" });
    const tile = await addGridItem(svc.db, t.actor, page.id, { imageAssetId: img.id, targetUrl: "https://shop.example.de/p/1" });
    await expect(addGridItem(svc.db, t.actor, page.id, { targetUrl: "https://x.de" })).rejects.toMatchObject({ code: "MEDIA_INVALID" });
    const snap = await publishStartPage(svc.db, t.actor, page.id);
    expect(snapshotHasAsset(snap, img.id)).toBe(true);
    expect(snapshotHasAsset(snap, other.id)).toBe(false);
    expect(resolveClickTarget(snap, tile.id)).toBe("https://shop.example.de/p/1");
    // foreign tenant's asset cannot be referenced
    const f = await createTenant(svc);
    const foreign = await uploadAsset(svc, f.actor, f.workspace.id, "image");
    await expect(addBlock(svc.db, t.actor, page.id, "image", { assetId: foreign.id })).rejects.toBeTruthy();
  });

  it("first-party stats exclude bots and count clicks per block", async () => {
    const t = await createTenant(svc);
    const page = await getOrCreateStartPage(svc.db, t.actor, t.workspace.id);
    const btn = await addBlock(svc.db, t.actor, page.id, "button", { label: "Go", url: "https://example.de" });
    const base = { organizationId: t.organization.id, workspaceId: t.workspace.id, startPageId: page.id, referrer: "https://instagram.com/x" };
    const mobile = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile";
    await recordLinkEvent(svc.db, { ...base, kind: "page_view", userAgent: mobile });
    await recordLinkEvent(svc.db, { ...base, kind: "page_view", userAgent: "Mozilla/5.0 (Windows NT 10.0)" });
    await recordLinkEvent(svc.db, { ...base, kind: "page_view", userAgent: "facebookexternalhit/1.1" });
    await recordLinkEvent(svc.db, { ...base, kind: "block_click", blockId: btn.id, userAgent: mobile });
    const s = await startPageStats(svc.db, t.actor, page.id);
    expect(s.views).toBe(2);
    expect(s.clicks).toBe(1);
    expect(s.ctr).toBe(50);
    expect(s.clicksByBlock[btn.id]).toBe(1);
    expect(deviceClass(null)).toBe("bot");
    const rows = await svc.db.select().from(schema.linkEvents).where(eq(schema.linkEvents.startPageId, page.id));
    expect(rows.every((r) => !("ip" in r))).toBe(true);
    expect(rows[0]!.referrerHost).toBe("instagram.com");
  });
});

describe("Short links", () => {
  it("reuses codes per target, counts clicks, honours disable, rewrites captions", async () => {
    const t = await createTenant(svc);
    const a = await createShortLink(svc.db, t.actor, { workspaceId: t.workspace.id, targetUrl: "https://shop.example.de/herbst" });
    const b = await createShortLink(svc.db, t.actor, { workspaceId: t.workspace.id, targetUrl: "https://shop.example.de/herbst" });
    expect(a.id).toBe(b.id);
    expect(a.code).toMatch(/^[0-9A-Za-z]{7}$/);
    await expect(createShortLink(svc.db, t.actor, { workspaceId: t.workspace.id, targetUrl: "javascript:alert(1)" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    expect(await resolveShortLink(svc.db, a.code, { userAgent: "Mozilla/5.0 Mobile", referrer: null })).toBe("https://shop.example.de/herbst");
    expect(await resolveShortLink(svc.db, "../../etc", { userAgent: null, referrer: null })).toBeNull();
    const [row] = await svc.db.select().from(schema.shortLinks).where(eq(schema.shortLinks.id, a.id));
    expect(row!.clicks).toBe(1);

    const text = await shortenLinksInText(svc.db, t.actor, { workspaceId: t.workspace.id, text: "Neu: https://shop.example.de/herbst. Und https://blog.example.de/post?x=1!", baseUrl: "https://sicht.link" });
    expect(text).toContain(`https://sicht.link/${a.code}.`);
    expect(text).not.toContain("blog.example.de");

    await disableShortLink(svc.db, t.actor, a.id);
    expect(await resolveShortLink(svc.db, a.code, { userAgent: null, referrer: null })).toBeNull();

    const other = await createTenant(svc);
    await expect(disableShortLink(svc.db, other.actor, b.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Integrations", () => {
  it("reports honest statuses and plan gating", async () => {
    const pro = await createTenant(svc, { plan: "pro" });
    const starter = await createTenant(svc, { plan: "starter" });
    const lp = await listIntegrations(svc.db, svc.config, pro.actor);
    const ls = await listIntegrations(svc.db, svc.config, starter.actor);
    const st = (l: typeof lp, id: string) => l.find((i) => i.id === id)!.status;
    expect(st(lp, "zapier")).toBe("available");
    expect(st(ls, "zapier")).toBe("plan_locked");
    expect(st(lp, "canva")).toBe("not_configured");
    expect(st(lp, "unsplash")).toBe("not_configured"); // no key in test config
    await expect(unsplashSearch(svc.config, "kaffee")).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
  });

  it("Bitly: token verified then stored encrypted; shorten uses it; rejected token is not stored", async () => {
    const t = await createTenant(svc);
    const token = "bitly-secret-token-123";
    const calls: { url: string; auth: string | null }[] = [];
    const http = fakeFetch((url, init) => {
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      if (url.endsWith("/v4/user")) return { status: 200, body: { login: "marke", default_group_guid: "Bg1" } };
      return { status: 200, body: { link: "https://bit.ly/3abc" } };
    });
    await expect(connectBitly(svc.db, svc.ring, t.actor, "bad", fakeFetch(() => ({ status: 403, body: {} })))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await svc.db.select().from(schema.integrationCredentials).where(eq(schema.integrationCredentials.organizationId, t.organization.id))).toHaveLength(0);

    await connectBitly(svc.db, svc.ring, t.actor, token, http);
    const [cred] = await svc.db.select().from(schema.integrationCredentials).where(eq(schema.integrationCredentials.organizationId, t.organization.id));
    expect(cred!.secretEnc).not.toContain(token);
    expect((await listIntegrations(svc.db, svc.config, t.actor)).find((i) => i.id === "bitly")!.status).toBe("connected");
    expect(await bitlyShorten(svc.db, svc.ring, t.actor, "https://shop.example.de", http)).toBe("https://bit.ly/3abc");
    expect(calls.at(-1)!.auth).toBe(`Bearer ${token}`);
  });
});

describe("Status", () => {
  it("degraded without a live worker, operational with a fresh heartbeat; stale heartbeats age out", async () => {
    const s0 = await systemStatus(svc.db);
    expect(s0.db).toBe(true);
    await recordHeartbeat(svc.db, "test-host:1", "worker");
    const s1 = await systemStatus(svc.db);
    expect(s1.workers.some((w) => w.ok)).toBe(true);
    expect(s1.overall).toBe("operational");
    const later = new Date(Date.now() + 10 * 60_000);
    expect((await systemStatus(svc.db, later)).overall).toBe("degraded");
  });
});

describe("Public API: Postman + /links + SDKs end-to-end", () => {
  let app: ReturnType<typeof createApiApp>;
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    app = createApiApp(svc, { allowPrivateWebhookUrls: true });
    server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const r = await app.fetch(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks) }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

  async function tenantKey() {
    const t = await createTenant(svc);
    const { secret } = await createApiKey(svc.db, t.actor, { name: "SDK", scopes: ["workspaces:read", "accounts:read", "media:write", "posts:read", "posts:write", "webhooks:manage", "usage:read"], workspaceIds: [t.workspace.id] });
    return { ...t, key: secret };
  }

  it("Postman collection mirrors the OpenAPI document", async () => {
    const r = await app.request("/postman.json");
    expect(r.status).toBe(200);
    const col = (await r.json()) as { info: { schema: string }; auth: { type: string }; item: { name: string; item: { request: { method: string; header: { key: string }[] } }[] }[] };
    expect(col.info.schema).toContain("v2.1.0");
    expect(col.auth.type).toBe("bearer");
    const reqs = col.item.flatMap((f) => f.item);
    expect(reqs.length).toBeGreaterThan(20);
    expect(col.item.some((f) => f.name === "Links")).toBe(true);
    for (const q of reqs) expect(q.request.header.some((h) => h.key === "Idempotency-Key")).toBe(q.request.method !== "GET");
  });

  it("TypeScript SDK: upload, idempotent create, 422 on key reuse, typed errors, short link, webhook verify", async () => {
    const t = await tenantKey();
    const st = new SichtTakt({ apiKey: t.key, baseUrl: base, maxRetries: 0 });
    expect((await st.workspaces.list()).data).toHaveLength(1);
    const asset = await st.media.upload({ workspace_id: t.workspace.id, filename: "a.jpg", mime_type: "image/jpeg", data: new Uint8Array(jpeg(1080, 1080)) });
    expect(asset.status).toBe("ready");
    const body = { workspace_id: t.workspace.id, account_ids: [t.channel.id], type: "image" as const, caption: "SDK", media_asset_ids: [asset.id], status: "draft" as const };
    const p1 = await st.posts.create(body, "cms-entry-0001");
    const p2 = await st.posts.create(body, "cms-entry-0001");
    expect(p2.id).toBe(p1.id);
    await expect(st.posts.create({ ...body, caption: "anders" }, "cms-entry-0001")).rejects.toMatchObject({ status: 422, code: "IDEMPOTENCY_KEY_REUSED" });
    const err = await st.posts.create({ ...body, account_ids: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(SichtTaktError);
    expect((err as SichtTaktError).requestId).toBeTruthy();
    const link = await st.links.create({ workspace_id: t.workspace.id, url: "https://shop.example.de/x" });
    expect(link.short_url).toMatch(new RegExp(`/l/${link.code}$`));
    const again = await st.links.create({ workspace_id: t.workspace.id, url: "https://shop.example.de/x" });
    expect(again.code).toBe(link.code);

    const { createHmac } = await import("node:crypto");
    const ts = Math.floor(Date.now() / 1000);
    const raw = '{"event":"post.published"}';
    const sig = `t=${ts},v1=${createHmac("sha256", "whsec_x").update(`${ts}.${raw}`).digest("hex")}`;
    expect(await verifyWebhook("whsec_x", raw, sig)).toBe(true);
    expect(await verifyWebhook("whsec_x", raw + " ", sig)).toBe(false);
    expect(await verifyWebhook("whsec_x", raw, sig, ts + 301)).toBe(false);
    expect(() => new SichtTakt({ apiKey: "nope" })).toThrow();
  });

  const php = process.env.PHP_BIN;
  it.skipIf(!php || !existsSync(php))("PHP SDK end-to-end against the running API", async () => {
    const t = await tenantKey();
    const dir = mkdtempSync(path.join(os.tmpdir(), "sichttakt-php-"));
    const img = path.join(dir, "bild.jpg");
    writeFileSync(img, jpeg(1080, 1350));
    const script = path.resolve(__dirname, "../sdks/php/examples/e2e.php");
    const { stdout } = await promisify(execFile)(php!, [script], { env: { ...process.env, ST_BASE: base, ST_KEY: t.key, ST_WS: t.workspace.id, ST_CH: t.channel.id, ST_IMG: img }, timeout: 60_000 });
    const out = JSON.parse(stdout);
    expect(out).toMatchObject({
      workspaces: 1,
      accounts: 1,
      asset_status: "ready",
      post_status: "DRAFT",
      idempotent_same_id: true,
      idem_conflict: 422,
      fetched_caption: "Grüße aus dem PHP-SDK",
      webhook_valid: true,
      webhook_tampered: false,
      webhook_stale: false,
    });
    expect(out.short_url).toMatch(/\/l\/[0-9A-Za-z]{7}$/);
    expect(out.validation_error[0]).toBe(422);
    expect(out.validation_error[2]).toBe(true);
  }, 90_000);
});
