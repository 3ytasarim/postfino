import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, schema } from "@sichttakt/db";
import { createApiKey, buildUserActor, getPost } from "@sichttakt/core";
import { createApiApp } from "@sichttakt/api";
import { createTestServices, createTenant, inMinutes } from "./helpers";
import { jpeg, mp4 } from "./fixtures";

let svc: Awaited<ReturnType<typeof createTestServices>>;
let app: ReturnType<typeof createApiApp>;

beforeAll(async () => {
  svc = await createTestServices();
  app = createApiApp(svc, { allowPrivateWebhookUrls: true });
});
afterAll(() => svc.close());

type Tenant = Awaited<ReturnType<typeof createTenant>> & { key: string };
async function tenantWithKey(plan: "pro" | "agency" = "pro", scopes = ["workspaces:read", "accounts:read", "media:write", "posts:read", "posts:write", "posts:publish", "calendar:read", "analytics:read", "webhooks:manage", "usage:read"] as const): Promise<Tenant> {
  const t = await createTenant(svc, { plan });
  const { secret } = await createApiKey(svc.db, t.actor, { name: "CMS", scopes: [...scopes], workspaceIds: [t.workspace.id] });
  return { ...t, key: secret };
}

const call = (key: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(body !== undefined && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : body instanceof Uint8Array ? (body as unknown as BodyInit) : JSON.stringify(body),
  });

async function upload(t: Tenant, kind: "video" | "cover") {
  const data = kind === "video" ? mp4({ durationMs: 9000, width: 1080, height: 1920 }) : jpeg(1080, 1920);
  const r = await call(t.key, "POST", "/api/v1/media/uploads", { workspace_id: t.workspace.id, filename: kind === "video" ? "reel_video.mp4" : "cover.jpg", mime_type: kind === "video" ? "video/mp4" : "image/jpeg", size_bytes: data.length, purpose: kind === "video" ? "video" : "cover" }, { "idempotency-key": crypto.randomUUID() });
  expect(r.status).toBe(201);
  const { id } = (await r.json()) as { id: string };
  const put = await call(t.key, "PUT", `/api/v1/media/${id}/content`, new Uint8Array(data), { "content-type": kind === "video" ? "video/mp4" : "image/jpeg" });
  expect(put.status).toBe(200);
  return id;
}

describe("public API v1", () => {
  it("rejects missing / malformed / revoked keys", async () => {
    expect((await app.request("/api/v1/workspaces")).status).toBe(401);
    expect((await call("st_live_nope", "GET", "/api/v1/workspaces")).status).toBe(401);
    const t = await tenantWithKey();
    const keyId = (await svc.db.select().from(schema.apiKeys).where(eq(schema.apiKeys.organizationId, t.organization.id)))[0]!.id;
    expect((await call(t.key, "GET", "/api/v1/workspaces")).status).toBe(200);
    await svc.db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(eq(schema.apiKeys.id, keyId));
    const r = await call(t.key, "GET", "/api/v1/workspaces");
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("API_KEY_REVOKED");
  });

  it("Starter plan cannot create API keys (backend-enforced)", async () => {
    const t = await createTenant(svc, { plan: "starter" });
    await expect(createApiKey(svc.db, t.actor, { name: "x", scopes: ["posts:read"], workspaceIds: [t.workspace.id] })).rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
  });

  it("downgrade to Starter blocks an existing key immediately", async () => {
    const t = await tenantWithKey();
    await svc.db.update(schema.subscriptions).set({ planCode: "starter" }).where(eq(schema.subscriptions.organizationId, t.organization.id));
    const r = await call(t.key, "GET", "/api/v1/workspaces");
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("PLAN_FEATURE_UNAVAILABLE");
  });

  it("end-to-end: external CMS uploads video + independent cover, schedules a reel, gets webhook-ready status", async () => {
    const t = await tenantWithKey();
    const hook = await call(t.key, "POST", "/api/v1/webhooks", { url: "http://localhost:9/hook", events: ["post.created", "post.scheduled", "post.published"] }, { "idempotency-key": crypto.randomUUID() });
    expect(hook.status).toBe(201);
    expect(((await hook.json()) as { secret: string }).secret).toMatch(/^whsec_/);

    const videoId = await upload(t, "video");
    const coverId = await upload(t, "cover");
    expect(videoId).not.toBe(coverId);

    const body = { workspace_id: t.workspace.id, account_ids: [t.channel.id], type: "reel", caption: "Unser neuer Cocktail ist da!", video_asset_id: videoId, cover_asset_id: coverId, scheduled_at: inMinutes(30).toISOString(), status: "scheduled" };
    const idemKey = crypto.randomUUID();
    const r1 = await call(t.key, "POST", "/api/v1/posts", body, { "idempotency-key": idemKey });
    expect(r1.status).toBe(202);
    const p1 = (await r1.json()) as { id: string; status: string; cover_mode: string };
    expect(p1.status).toBe("SCHEDULED");
    expect(p1.cover_mode).toBe("independent_image");

    // Same Idempotency-Key → same response, no second post
    const r2 = await call(t.key, "POST", "/api/v1/posts", body, { "idempotency-key": idemKey });
    expect(r2.headers.get("idempotent-replayed")).toBe("true");
    expect(((await r2.json()) as { id: string }).id).toBe(p1.id);
    const all = await svc.db.select().from(schema.posts).where(eq(schema.posts.organizationId, t.organization.id));
    expect(all).toHaveLength(1);

    // Same key, different body → 422
    const r3 = await call(t.key, "POST", "/api/v1/posts", { ...body, caption: "anders" }, { "idempotency-key": idemKey });
    expect(r3.status).toBe(422);

    // Missing key → 400
    expect((await call(t.key, "POST", "/api/v1/posts", body)).status).toBe(400);

    const g = await call(t.key, "GET", `/api/v1/posts/${p1.id}`);
    expect(g.status).toBe(200);

    const deliveries = await svc.db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.organizationId, t.organization.id));
    expect(deliveries.map((d) => d.event).sort()).toEqual(["post.created", "post.scheduled"]);

    const cal = await call(t.key, "GET", `/api/v1/calendar?workspace_id=${t.workspace.id}&from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(inMinutes(60 * 24).toISOString())}`);
    expect(((await cal.json()) as { data: unknown[] }).data).toHaveLength(1);

    const a = await call(t.key, "GET", `/api/v1/analytics/posts/${p1.id}`);
    expect(((await a.json()) as { targets: unknown[] }).targets).toEqual([]); // not published → no fabricated metrics
  });

  it("tenant A key cannot access tenant B workspace, accounts, media or posts", async () => {
    const a = await tenantWithKey();
    const b = await tenantWithKey();
    const bVideo = await upload(b, "video");
    const bPost = await call(b.key, "POST", "/api/v1/posts", { workspace_id: b.workspace.id, account_ids: [b.channel.id], type: "reel", caption: "B", video_asset_id: bVideo, status: "draft" }, { "idempotency-key": crypto.randomUUID() });
    const bPostId = ((await bPost.json()) as { id: string }).id;

    expect((await call(a.key, "GET", `/api/v1/posts/${bPostId}`)).status).toBe(404);
    expect((await call(a.key, "GET", `/api/v1/media/${bVideo}`)).status).toBe(404);
    expect((await call(a.key, "PATCH", `/api/v1/posts/${bPostId}`, { caption: "hijack" }, { "idempotency-key": crypto.randomUUID() })).status).toBe(404);
    expect((await call(a.key, "POST", `/api/v1/posts/${bPostId}/publish`, undefined, { "idempotency-key": crypto.randomUUID() })).status).toBe(404);
    const wsList = (await (await call(a.key, "GET", "/api/v1/workspaces")).json()) as { data: { id: string }[] };
    expect(wsList.data.map((w) => w.id)).toEqual([a.workspace.id]);
    const acc = (await (await call(a.key, "GET", `/api/v1/accounts?workspace_id=${b.workspace.id}`)).json()) as { data: unknown[] };
    expect(acc.data).toEqual([]);
    // A's key referencing B's account and B's media inside A's workspace
    const cross = await call(a.key, "POST", "/api/v1/posts", { workspace_id: a.workspace.id, account_ids: [b.channel.id], type: "reel", caption: "x", video_asset_id: bVideo, status: "draft" }, { "idempotency-key": crypto.randomUUID() });
    expect(cross.status).toBe(404);
    const crossWs = await call(a.key, "POST", "/api/v1/posts", { workspace_id: b.workspace.id, account_ids: [b.channel.id], type: "reel", caption: "x", video_asset_id: bVideo, status: "draft" }, { "idempotency-key": crypto.randomUUID() });
    expect(crossWs.status).toBe(404);
    // B's post untouched
    const bActor = (await buildUserActor(svc.db, b.user.id, b.organization.id))!;
    expect((await getPost(svc.db, bActor, bPostId)).post.caption).toBe("B");
  });

  it("scopes are enforced", async () => {
    const t = await tenantWithKey("pro", ["posts:read"] as never);
    const r = await call(t.key, "POST", "/api/v1/webhooks", { url: "https://example.com/h", events: ["post.published"] }, { "idempotency-key": crypto.randomUUID() });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("monthly quota returns 429 with Retry-After and emits quota.threshold_reached", async () => {
    const t = await tenantWithKey();
    await svc.db.insert(schema.webhookSubscriptions).values({ organizationId: t.organization.id, url: "https://example.test/h", events: ["quota.threshold_reached"], secretEnc: "x", keyVersion: "dev" });
    await svc.db.update(schema.subscriptions).set({ limitOverrides: { apiRequestsPerMonth: 5 } }).where(eq(schema.subscriptions.organizationId, t.organization.id));
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await call(t.key, "GET", "/api/v1/usage")).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    const r = await call(t.key, "GET", "/api/v1/usage");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    const d = await svc.db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.organizationId, t.organization.id));
    expect(d.map((x) => (x.payload as { data: { threshold_percent: number } }).data.threshold_percent).sort()).toEqual([100, 80]);
  });

  it("test keys may only use sandbox accounts", async () => {
    const t = await createTenant(svc);
    const { secret } = await createApiKey(svc.db, t.actor, { name: "test", scopes: ["accounts:connect", "posts:write"], workspaceIds: [t.workspace.id], environment: "test" });
    const r = await call(secret, "POST", "/api/v1/accounts/connect", { workspace_id: t.workspace.id, platform: "instagram_business" }, {});
    expect(r.status).toBe(403);
    const ok = await call(secret, "POST", "/api/v1/accounts/connect", { workspace_id: t.workspace.id, platform: "sandbox" }, {});
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { authorization_url: string }).authorization_url).toContain("/oauth/callback");
  });

  it("signed media URLs expire and cannot be forged", async () => {
    const t = await tenantWithKey();
    const id = await upload(t, "cover");
    const [asset] = await svc.db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.id, id));
    const url = new URL(svc.storage.signedUrl(asset!.storageKey, 60)!);
    expect((await app.request(url.pathname + url.search)).status).toBe(200);
    url.searchParams.set("sig", "0".repeat(64));
    expect((await app.request(url.pathname + url.search)).status).toBe(403);
  });
});
