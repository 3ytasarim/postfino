import { oauthRedirectUri } from "@sichttakt/config";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { openapiToPostman } from "./postman";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AppError,
  createPostSchema,
  updatePostSchema,
  mediaUploadSchema,
  createWebhookSchema,
  isAppError,
  PLATFORMS,
  type WebhookEvent,
} from "@sichttakt/shared";
import { and, eq, inArray, schema } from "@sichttakt/db";
import { ProviderError } from "@sichttakt/social-adapters";
import {
  verifyApiKey,
  takeBurstToken,
  consumeApiRequest,
  getEntitlements,
  withIdempotency,
  emitEvent,
  listWorkspacesFor,
  listChannels,
  beginConnect,
  completeConnect,
  connectWithCredentials,
  StripeBilling,
  handleStripeEvent,
  isBillingConfigured,
  createMediaAsset,
  storeMediaContent,
  getAsset,
  createPost,
  getPost,
  updatePost,
  decideApproval,
  requestPublish,
  cancelPost,
  listPosts,
  postView,
  getUsage,
  createWebhook,
  listWebhooks,
  deleteWebhook,
  LocalStorageDriver,
  listPostInsights,
  createShortLink,
  reschedulePost,
  clonePost,
  listSlots,
  setSlots,
  type Actor,
  parseMetaSignedRequest,
  revokeMetaUser,
  metaDeletionCode,
  type Services,
} from "@sichttakt/core";

type ApiActor = Extract<Actor, { kind: "api_key" }>;
type Env = { Variables: { actor: ApiActor; requestId: string } };

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApiApp(svc: Services, opts: { allowPrivateWebhookUrls?: boolean } = {}) {
  const { db } = svc;
  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (isAppError(err)) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json({ error: { code: err.code, message: err.message, details: err.details ?? null, request_id: c.get("requestId") } }, err.status as 400);
    }
    if (err instanceof z.ZodError) {
      return c.json({ error: { code: "VALIDATION_FAILED", message: "Request validation failed", details: err.issues, request_id: c.get("requestId") } }, 422);
    }
    console.error("[api] unhandled", err);
    return c.json({ error: { code: "INTERNAL", message: "Internal error", request_id: c.get("requestId") } }, 500);
  });

  app.use("*", async (c, next) => {
    c.set("requestId", c.req.header("x-request-id") ?? crypto.randomUUID());
    c.header("X-Request-Id", c.get("requestId"));
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-store");
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true }));
  // Root: tells a human (e.g. opening a tunnel URL) that this is the API, not the web app.
  app.get("/", (c) => c.json({ service: "Postfino API", status: "ok", docs: "/api/v1/openapi.yaml", oauthCallback: "/oauth/callback" }));

  // ── OAuth callback for channel connections started from the web app or the API ──
  app.get("/oauth/callback", async (c) => {
    const state = c.req.query("state");
    const code = c.req.query("code");
    const back = (key: string, value: string, redirectAfter?: string | null) => {
      const target = new URL(redirectAfter ?? `${svc.config.APP_URL}/app/channels`);
      target.searchParams.set(key, value.slice(0, 300));
      return c.redirect(target.toString());
    };
    // User cancelled at the provider (error=access_denied etc.) → back to the app with a readable message.
    if (!state || !code) return back("error", c.req.query("error_description") ?? c.req.query("error") ?? "missing state/code");
    try {
      const { channels, redirectAfter } = await completeConnect(db, svc.ring, svc.registry, { state, code, redirectUri: oauthRedirectUri(svc.config) });
      return back("connected", String(channels.length), redirectAfter);
    } catch (e) {
      if (isAppError(e) || e instanceof ProviderError) return back("error", (e as Error).message);
      throw e;
    }
  });

  // ── Signed media URLs (what Meta fetches). No auth header: signature + expiry protect the object. ──
  app.get("/media-files/*", async (c) => {
    const key = decodeURIComponent(c.req.path.replace(/^\/media-files\//, ""));
    const exp = Number(c.req.query("exp"));
    const sig = c.req.query("sig") ?? "";
    // Only the local driver serves files itself; S3 presigned URLs point directly at the bucket.
    if (!(svc.storage instanceof LocalStorageDriver) || !svc.storage.verify(key, exp, sig)) return c.text("forbidden", 403);
    const [asset] = await db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.storageKey, key));
    if (!asset || asset.status !== "ready") return c.text("not found", 404);
    const data = await svc.storage.get(key);
    return new Response(new Uint8Array(data), { headers: { "content-type": asset.mimeType, "content-length": String(data.length), "cache-control": "private, max-age=300" } });
  });

  // ── Stripe webhooks: raw body + signature; idempotent per event id. 2xx only after the event is stored. ──
  app.post("/billing/webhooks/stripe", async (c) => {
    if (!isBillingConfigured(svc.config)) return c.json({ error: { code: "PROVIDER_NOT_CONFIGURED", message: "billing not configured" } }, 503);
    const stripe = new StripeBilling(svc.config);
    const raw = await c.req.text();
    const event = stripe.verifyWebhook(raw, c.req.header("stripe-signature") ?? null);
    const result = await handleStripeEvent(db, stripe, event);
    return c.json({ received: true, result });
  });

  app.get("/postman.json", async (c) => {
    const yaml = await readFile(path.join(here, "..", "..", "..", "docs", "API_OPENAPI.yaml"), "utf8");
    return c.json(openapiToPostman(parseYaml(yaml), svc.config.API_URL), 200, { "content-disposition": 'attachment; filename="sichttakt-api.postman_collection.json"' });
  });

  app.get("/api/v1/openapi.yaml", async (c) => {
    const yaml = await readFile(path.join(here, "..", "..", "..", "docs", "API_OPENAPI.yaml"), "utf8");
    return c.body(yaml, 200, { "content-type": "application/yaml; charset=utf-8" });
  });

  // ── Meta callbacks (App Dashboard): data deletion request + deauthorize. Authenticated by the signed_request HMAC. ──
  const metaSigned = async (c: Context<Env>) => {
    const secret = svc.config.META_APP_SECRET;
    if (!secret) throw new AppError("PROVIDER_NOT_CONFIGURED", "meta_not_configured");
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const signed = typeof form.signed_request === "string" ? form.signed_request : "";
    return { secret, req: parseMetaSignedRequest(signed, secret) };
  };
  app.post("/api/v1/meta/data-deletion", async (c) => {
    const { secret, req } = await metaSigned(c);
    await revokeMetaUser(db, req.user_id, "delete");
    const code = metaDeletionCode(secret, req.user_id, req.issued_at);
    const status = new URL("/datenloeschung", svc.config.APP_URL);
    status.searchParams.set("code", code);
    return c.json({ url: status.toString(), confirmation_code: code });
  });
  app.post("/api/v1/meta/deauthorize", async (c) => {
    const { req } = await metaSigned(c);
    await revokeMetaUser(db, req.user_id, "deauthorize");
    return c.json({ ok: true });
  });

  // ── Auth + plan + quota middleware for every /api/v1 route ──
  const v1 = new Hono<Env>();
  v1.use("*", async (c, next) => {
    const started = Date.now();
    const auth = c.req.header("authorization") ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m) throw new AppError("UNAUTHENTICATED", "Missing Authorization: Bearer <api key>");
    const actor = await verifyApiKey(db, m[1]!.trim());
    c.set("actor", actor);
    let status = 500;
    let errorCode: string | undefined;
    try {
      const ent = await getEntitlements(db, actor.organizationId);
      if (!ent.features.has("public_api")) throw new AppError("PLAN_FEATURE_UNAVAILABLE", `Public API is not included in plan ${ent.planCode}`, { plan: ent.planCode });
      const burst = takeBurstToken(actor.apiKeyId, ent.limits.apiRequestsPerMinute);
      if (!burst.ok) throw new AppError("RATE_LIMITED", "Too many requests for this API key", undefined, burst.retryAfter);
      const usage = await consumeApiRequest(db, actor.organizationId);
      c.header("X-Quota-Limit", String(usage.limit));
      c.header("X-Quota-Remaining", String(Math.max(0, usage.limit - usage.used)));
      if (usage.crossed)
        await emitEvent(db, { organizationId: actor.organizationId, event: "quota.threshold_reached", data: { metric: "api_requests", threshold_percent: usage.crossed, used: usage.used, limit: usage.limit } });
      await next();
      status = c.res.status;
    } catch (e) {
      status = isAppError(e) ? e.status : e instanceof z.ZodError ? 422 : 500;
      errorCode = isAppError(e) ? e.code : undefined;
      throw e;
    } finally {
      await db
        .insert(schema.apiRequestLogs)
        .values({ organizationId: actor.organizationId, apiKeyId: actor.apiKeyId, method: c.req.method, path: c.req.routePath ?? c.req.path, status, errorCode, durationMs: Date.now() - started, ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null, requestId: c.get("requestId") })
        .catch(() => {});
    }
  });

  const actorOf = (c: Context<Env>) => c.get("actor");
  const requireScope = (c: Context<Env>, scope: ApiActor["scopes"][number]) => {
    if (!actorOf(c).scopes.includes(scope)) throw new AppError("INSUFFICIENT_SCOPE", `This endpoint requires scope ${scope}`);
  };
  const body = async (c: Context<Env>) => {
    try {
      return await c.req.json();
    } catch {
      throw new AppError("VALIDATION_FAILED", "Body must be valid JSON");
    }
  };
  const idem = (c: Context<Env>, payload: unknown, run: () => Promise<{ status: number; body: unknown }>) =>
    withIdempotency(db, { organizationId: actorOf(c).organizationId, apiKeyId: actorOf(c).apiKeyId, key: c.req.header("idempotency-key"), method: c.req.method, path: c.req.path, body: payload }, run).then((r) => {
      if (r.replayed) c.header("Idempotent-Replayed", "true");
      return c.json(r.body as object, r.status as 200);
    });

  /** Test keys (st_test_) may only touch sandbox accounts; live keys never see sandbox noise unless asked. */
  async function assertKeyEnvironment(c: Context<Env>, accountIds: string[]) {
    const a = actorOf(c);
    if (a.environment !== "test" || accountIds.length === 0) return;
    const rows = await db.select({ id: schema.channels.id, isSandbox: schema.channels.isSandbox }).from(schema.channels).where(inArray(schema.channels.id, accountIds));
    if (rows.some((r) => !r.isSandbox)) throw new AppError("FORBIDDEN", "Test API keys can only use sandbox accounts");
  }

  v1.get("/workspaces", async (c) => {
    requireScope(c, "workspaces:read");
    const rows = await listWorkspacesFor(db, actorOf(c));
    return c.json({ data: rows.map((w) => ({ id: w.id, name: w.name, timezone: w.timezone, approval_required: w.approvalRequired })) });
  });

  v1.get("/accounts", async (c) => {
    requireScope(c, "accounts:read");
    const ws = c.req.query("workspace_id");
    let rows = await listChannels(db, actorOf(c), ws);
    if (actorOf(c).environment === "test") rows = rows.filter((r) => r.is_sandbox);
    return c.json({ data: rows });
  });

  v1.post("/accounts/connect", async (c) => {
    requireScope(c, "accounts:connect");
    const p = z
      .object({
        workspace_id: z.string().uuid(),
        platform: z.enum(PLATFORMS),
        redirect_after: z.string().url().optional(),
        /** Mastodon: instance host, e.g. mastodon.social */
        instance: z.string().max(253).optional(),
        /** Bluesky: handle + app password (used once, never stored). */
        credentials: z.object({ identifier: z.string().min(3).max(253), app_password: z.string().min(19).max(19), service: z.string().url().optional() }).optional(),
      })
      .parse(await body(c));
    if (actorOf(c).environment === "test" && p.platform !== "sandbox") throw new AppError("FORBIDDEN", "Test API keys can only connect sandbox accounts");
    if (p.platform === "bluesky") {
      if (!p.credentials) throw new AppError("VALIDATION_FAILED", "credentials required for bluesky");
      const accounts = await connectWithCredentials(db, svc.ring, svc.registry, actorOf(c), { workspaceId: p.workspace_id, platform: "bluesky", identifier: p.credentials.identifier, password: p.credentials.app_password, service: p.credentials.service });
      return c.json({ data: accounts }, 201);
    }
    const { url } = await beginConnect(db, svc.registry, actorOf(c), { workspaceId: p.workspace_id, platform: p.platform, instance: p.instance, redirectUri: oauthRedirectUri(svc.config), redirectAfter: p.redirect_after });
    return c.json({ authorization_url: url, expires_in: 900 });
  });

  v1.post("/media/uploads", async (c) => {
    requireScope(c, "media:write");
    const raw = await body(c);
    return idem(c, raw, async () => {
      const p = mediaUploadSchema.parse(raw);
      const a = await createMediaAsset(db, actorOf(c), { workspaceId: p.workspace_id, filename: p.filename, mimeType: p.mime_type, sizeBytes: p.size_bytes, purpose: p.purpose });
      return { status: 201, body: { id: a.id, status: a.status, upload: { method: "PUT", url: `${svc.config.API_URL}/api/v1/media/${a.id}/content`, headers: { "content-type": a.mimeType } } } };
    });
  });

  v1.put("/media/:id/content", async (c) => {
    requireScope(c, "media:write");
    const buf = Buffer.from(await c.req.arrayBuffer());
    const a = await storeMediaContent(db, svc.storage, actorOf(c), c.req.param("id"), buf, { ffprobePath: svc.config.FFPROBE_PATH, clamavHost: svc.config.CLAMAV_HOST, clamavPort: svc.config.CLAMAV_PORT });
    if (a.status === "rejected") {
      await emitEvent(db, { organizationId: a.organizationId, workspaceId: a.workspaceId, event: "media.failed", data: { asset_id: a.id, errors: a.validationErrors } });
      throw new AppError("MEDIA_INVALID", "Media failed validation", { asset_id: a.id, errors: a.validationErrors });
    }
    return c.json(mediaView(a));
  });

  v1.get("/media/:id", async (c) => {
    requireScope(c, "media:write");
    return c.json(mediaView(await getAsset(db, actorOf(c), c.req.param("id"))));
  });

  v1.post("/posts", async (c) => {
    requireScope(c, "posts:write");
    const raw = await body(c);
    return idem(c, raw, async () => {
      const p = createPostSchema.parse(raw);
      await assertKeyEnvironment(c, p.account_ids);
      const r = await createPost(db, svc.registry, actorOf(c), p);
      // 202: asynchronous publishing job queued; 201: stored as draft / awaiting approval.
      return { status: r.post.status === "SCHEDULED" ? 202 : 201, body: { ...r.post, validation: r.validation } };
    });
  });

  v1.get("/posts/:id", async (c) => {
    requireScope(c, "posts:read");
    const { post, targets } = await getPost(db, actorOf(c), c.req.param("id"));
    return c.json(postView(post, targets));
  });

  v1.patch("/posts/:id", async (c) => {
    requireScope(c, "posts:write");
    const raw = await body(c);
    return idem(c, raw, async () => ({ status: 200, body: await updatePost(db, actorOf(c), c.req.param("id"), updatePostSchema.parse(raw)) }));
  });

  v1.post("/posts/:id/approve", async (c) => {
    requireScope(c, "posts:publish");
    const raw = await c.req.json().catch(() => ({}));
    return idem(c, raw, async () => {
      const p = z.object({ decision: z.enum(["approved", "changes_requested"]).default("approved"), comment: z.string().max(2000).optional() }).parse(raw);
      return { status: 200, body: await decideApproval(db, actorOf(c), c.req.param("id"), p.decision, p.comment) };
    });
  });

  v1.post("/posts/:id/publish", async (c) => {
    requireScope(c, "posts:publish");
    return idem(c, {}, async () => ({ status: 202, body: await requestPublish(db, actorOf(c), c.req.param("id")) }));
  });

  v1.post("/posts/:id/cancel", async (c) => {
    requireScope(c, "posts:write");
    return idem(c, {}, async () => ({ status: 200, body: await cancelPost(db, actorOf(c), c.req.param("id")) }));
  });

  v1.post("/posts/:id/reschedule", async (c) => {
    requireScope(c, "posts:write");
    const raw = await body(c);
    return idem(c, raw, async () => {
      const p = z.object({ scheduled_at: z.string().datetime({ offset: true }) }).parse(raw);
      return { status: 200, body: await reschedulePost(db, actorOf(c), c.req.param("id"), new Date(p.scheduled_at)) };
    });
  });

  v1.post("/posts/:id/clone", async (c) => {
    requireScope(c, "posts:write");
    return idem(c, {}, async () => ({ status: 201, body: await clonePost(db, actorOf(c), c.req.param("id")) }));
  });

  v1.get("/accounts/:id/slots", async (c) => {
    requireScope(c, "calendar:read");
    return c.json({ data: (await listSlots(db, actorOf(c), c.req.param("id"))).map((s) => ({ weekday: s.weekday, minute_of_day: s.minuteOfDay })) });
  });

  v1.put("/accounts/:id/slots", async (c) => {
    requireScope(c, "posts:publish");
    const raw = await body(c);
    return idem(c, raw, async () => {
      const p = z.object({ slots: z.array(z.object({ weekday: z.number().int().min(1).max(7), minute_of_day: z.number().int().min(0).max(1439) })).max(200) }).parse(raw);
      const saved = await setSlots(db, actorOf(c), c.req.param("id"), p.slots.map((x) => ({ weekday: x.weekday, minuteOfDay: x.minute_of_day })));
      return { status: 200, body: { data: saved.map((x) => ({ weekday: x.weekday, minute_of_day: x.minuteOfDay })) } };
    });
  });

  v1.get("/calendar", async (c) => {
    requireScope(c, "calendar:read");
    const q = z.object({ workspace_id: z.string().uuid(), from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).parse(c.req.query());
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (to.getTime() - from.getTime() > 93 * 864e5) throw new AppError("VALIDATION_FAILED", "Range must not exceed 93 days");
    return c.json({ data: await listPosts(db, actorOf(c), { workspaceId: q.workspace_id, from, to }) });
  });

  v1.get("/analytics/posts/:id", async (c) => {
    requireScope(c, "analytics:read");
    const { post } = await getPost(db, actorOf(c), c.req.param("id"));
    const all = await listPostInsights(db, actorOf(c), { workspaceId: post.workspaceId, from: new Date(0), to: new Date(Date.now() + 864e5) });
    const mine = all.filter((x) => x.postId === post.id);
    // status: ok | not_available (platform does not provide it) | not_collected (not fetched yet). Never a fabricated 0.
    return c.json({
      post_id: post.id,
      targets: mine.map((x) => ({
        account_id: x.channelId,
        platform: x.platform,
        published_at: x.publishedAt.toISOString(),
        metrics: Object.fromEntries(Object.entries(x.metrics).map(([k, m]) => [k, { value: m.value, status: m.status, collected_at: m.collectedAt?.toISOString() ?? null }])),
      })),
    });
  });

  v1.post("/links", async (c) => {
    requireScope(c, "posts:write");
    const raw = await body(c);
    return idem(c, raw, async () => {
      const p = z.object({ workspace_id: z.string().uuid(), url: z.string().url() }).parse(raw);
      const l = await createShortLink(db, actorOf(c), { workspaceId: p.workspace_id, targetUrl: p.url });
      const base = (svc.config.SHORTLINK_BASE_URL ?? `${svc.config.APP_URL}/l`).replace(/\/$/, "");
      return { status: 201, body: { id: l.id, code: l.code, short_url: `${base}/${l.code}`, target_url: l.targetUrl, clicks: l.clicks } };
    });
  });

  v1.get("/usage", async (c) => {
    requireScope(c, "usage:read");
    return c.json(await getUsage(db, actorOf(c).organizationId));
  });

  v1.get("/webhooks", async (c) => {
    requireScope(c, "webhooks:manage");
    return c.json({ data: await listWebhooks(db, actorOf(c)) });
  });

  v1.post("/webhooks", async (c) => {
    requireScope(c, "webhooks:manage");
    const raw = await body(c);
    return idem(c, raw, async () => {
      const p = createWebhookSchema.parse(raw);
      if (!opts.allowPrivateWebhookUrls && !p.url.startsWith("https://")) throw new AppError("VALIDATION_FAILED", "Webhook URL must use https");
      const r = await createWebhook(db, svc.ring, actorOf(c), { url: p.url, events: p.events as WebhookEvent[], workspaceId: p.workspace_id, description: p.description });
      // The signing secret is only returned once.
      return { status: 201, body: { ...r.webhook, secret: r.secret } };
    });
  });

  v1.delete("/webhooks/:id", async (c) => {
    requireScope(c, "webhooks:manage");
    await deleteWebhook(db, actorOf(c), c.req.param("id"));
    return c.body(null, 204);
  });

  app.route("/api/v1", v1);
  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404));
  return app;
}

const mediaView = (a: typeof schema.mediaAssets.$inferSelect) => ({
  id: a.id,
  workspace_id: a.workspaceId,
  kind: a.kind,
  purpose: a.purpose,
  status: a.status,
  mime_type: a.mimeType,
  size_bytes: a.sizeBytes,
  width: a.width,
  height: a.height,
  duration_ms: a.durationMs,
  validation_errors: a.validationErrors,
});
