import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, schema } from "@sichttakt/db";
import { getConfig } from "@sichttakt/config";
import {
  StripeBilling,
  stripeForm,
  handleStripeEvent,
  startCheckout,
  listInvoices,
  getEntitlements,
  createApiKey,
  buildUserActor,
  adminListOrganizations,
  adminSetOrganizationPlan,
  adminUpdatePlan,
  updateBranding,
  setCustomDomain,
  verifyCustomDomain,
  publicBranding,
  createPost,
  getPost,
  markTargetPublishedManually,
  claimJobs,
  processPublishJob,
  type PublisherDeps,
} from "@sichttakt/core";
import { createApiApp } from "@sichttakt/api";
import { createTestServices, createTenant, uploadAsset, inMinutes } from "./helpers";
import { fakeHttp } from "./fake-http";

let svc: Awaited<ReturnType<typeof createTestServices>>;
const cfg = getConfig({ NODE_ENV: "test", API_URL: "http://localhost:3611", STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: "whsec_test", STRIPE_PRICE_STARTER: "price_starter", STRIPE_PRICE_PRO: "price_pro", STRIPE_PRICE_AGENCY: "price_agency" } as NodeJS.ProcessEnv);
beforeAll(async () => {
  svc = await createTestServices();
});
afterAll(() => svc.close());

const sign = (body: string, t = Math.floor(Date.now() / 1000), secret = "whsec_test") => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
let evSeq = 0;
const event = (type: string, object: Record<string, unknown>) => ({ id: `evt_${++evSeq}_${Date.now()}`, type, data: { object } });

describe("Stripe billing", () => {
  it("form encoding matches Stripe's nested syntax", () => {
    expect(stripeForm({ line_items: [{ price: "p", quantity: 1 }], subscription_data: { metadata: { organization_id: "o" } }, x: undefined }).toString()).toBe(
      "line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Bquantity%5D=1&subscription_data%5Bmetadata%5D%5Borganization_id%5D=o",
    );
  });

  it("checkout session: price per plan, org reference, B2B tax id, trial only once; enterprise is on request", async () => {
    const t = await createTenant(svc, { plan: "starter" });
    const h = fakeHttp([["POST", "https://api.stripe.com/v1/checkout/sessions", () => ({ json: { id: "cs_1", url: "https://checkout.stripe.test/cs_1" } })]]);
    const stripe = new StripeBilling(cfg, h.fetch);
    const r = await startCheckout(svc.db, stripe, t.actor, { plan: "pro", email: t.user.email, appUrl: "http://localhost:3610", trialDays: 14 });
    expect(r.url).toBe("https://checkout.stripe.test/cs_1");
    const body = Object.fromEntries(new URLSearchParams(h.calls[0]!.rawBody as string));
    expect(body).toMatchObject({ mode: "subscription", "line_items[0][price]": "price_pro", client_reference_id: t.organization.id, "tax_id_collection[enabled]": "true", "subscription_data[trial_period_days]": "14", customer_email: t.user.email });
    expect(h.calls[0]!.headers.authorization).toBe("Bearer sk_test_123");
    expect(h.calls[0]!.headers["idempotency-key"]).toContain(t.organization.id);
    await expect(startCheckout(svc.db, stripe, t.actor, { plan: "enterprise", email: "x@y.de", appUrl: "x", trialDays: 0 })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    // members without billing permission cannot start checkout
    const viewer = { ...t.actor, orgRole: "AGENCY_ADMIN" as const }; // admins manage everything except billing
    await expect(startCheckout(svc.db, stripe, viewer, { plan: "pro", email: "x@y.de", appUrl: "x", trialDays: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("webhook signature: valid accepted; tampered, wrong secret or stale rejected", () => {
    const stripe = new StripeBilling(cfg);
    const body = JSON.stringify(event("invoice.paid", {}));
    expect(stripe.verifyWebhook(body, sign(body)).type).toBe("invoice.paid");
    expect(() => stripe.verifyWebhook(body + " ", sign(body))).toThrow();
    expect(() => stripe.verifyWebhook(body, sign(body, undefined, "whsec_other"))).toThrow();
    expect(() => stripe.verifyWebhook(body, sign(body, Math.floor(Date.now() / 1000) - 301))).toThrow();
    expect(() => stripe.verifyWebhook(body, null)).toThrow();
  });

  it("subscription lifecycle drives plan + status; replays are no-ops; unpaid switches the API off", async () => {
    const t = await createTenant(svc, { plan: "starter" });
    const stripe = new StripeBilling(cfg);
    const period = { current_period_start: 1_800_000_000, current_period_end: 1_802_592_000 };
    expect(await handleStripeEvent(svc.db, stripe, event("checkout.session.completed", { client_reference_id: t.organization.id, customer: "cus_1", subscription: "sub_1" }))).toBe("processed");
    const sub = (s: string, price: string) => ({ id: "sub_1", customer: "cus_1", status: s, items: { data: [{ price: { id: price }, ...period }] } });
    const upd = event("customer.subscription.updated", sub("active", "price_pro"));
    expect(await handleStripeEvent(svc.db, stripe, upd)).toBe("processed");
    expect(await handleStripeEvent(svc.db, stripe, upd)).toBe("duplicate");
    let ent = await getEntitlements(svc.db, t.organization.id);
    expect(ent).toMatchObject({ planCode: "pro", status: "active" });
    expect(ent.periodEnd.getTime()).toBe(1_802_592_000_000);
    expect(ent.features.has("public_api")).toBe(true);

    // API key works on Pro…
    const actor = (await buildUserActor(svc.db, t.user.id, t.organization.id))!;
    const { secret } = await createApiKey(svc.db, actor, { name: "CMS", scopes: ["workspaces:read"], workspaceIds: [t.workspace.id] });
    const app = createApiApp(svc);
    expect((await app.request("/api/v1/workspaces", { headers: { authorization: `Bearer ${secret}` } })).status).toBe(200);
    // …payment fails (still active during dunning), then retries are exhausted → unpaid → API off immediately
    await handleStripeEvent(svc.db, stripe, event("invoice.payment_failed", { id: "in_1", customer: "cus_1", status: "open", amount_due: 5900, amount_paid: 0, currency: "eur", number: "ST-0001", created: 1_800_000_100 }));
    expect((await getEntitlements(svc.db, t.organization.id)).status).toBe("past_due");
    expect((await app.request("/api/v1/workspaces", { headers: { authorization: `Bearer ${secret}` } })).status).toBe(200);
    const notes = await svc.db.select().from(schema.notifications).where(eq(schema.notifications.organizationId, t.organization.id));
    expect(notes.map((n) => n.kind)).toContain("billing_payment_failed");
    await handleStripeEvent(svc.db, stripe, event("customer.subscription.updated", sub("unpaid", "price_pro")));
    ent = await getEntitlements(svc.db, t.organization.id);
    expect(ent.features.has("public_api")).toBe(false);
    expect((await app.request("/api/v1/workspaces", { headers: { authorization: `Bearer ${secret}` } })).status).toBe(403);
    // paid again → active; downgrade via portal to starter → plan follows the price
    await handleStripeEvent(svc.db, stripe, event("invoice.paid", { id: "in_1", customer: "cus_1", status: "paid", amount_due: 5900, amount_paid: 5900, currency: "eur", number: "ST-0001", hosted_invoice_url: "https://invoice.stripe.test/1", created: 1_800_000_100 }));
    await handleStripeEvent(svc.db, stripe, event("customer.subscription.updated", sub("active", "price_starter")));
    expect((await getEntitlements(svc.db, t.organization.id)).planCode).toBe("starter");
    const inv = await listInvoices(svc.db, actor);
    expect(inv).toHaveLength(1); // upserted, not duplicated
    expect(inv[0]).toMatchObject({ status: "paid", amountPaidCents: 5900, currency: "EUR", number: "ST-0001" });
    // incomplete (checkout abandoned) does not override the current state; deleted → cancelled
    await handleStripeEvent(svc.db, stripe, event("customer.subscription.updated", sub("incomplete", "price_agency")));
    expect((await getEntitlements(svc.db, t.organization.id)).status).toBe("active");
    await handleStripeEvent(svc.db, stripe, event("customer.subscription.deleted", sub("canceled", "price_starter")));
    expect((await getEntitlements(svc.db, t.organization.id)).status).toBe("cancelled");
    // unknown customers are recorded as ignored, never applied to a random org
    expect(await handleStripeEvent(svc.db, stripe, event("customer.subscription.updated", { id: "sub_x", customer: "cus_unknown", status: "active", items: { data: [] } }))).toBe("ignored");
  });

  it("HTTP endpoint: 503 when not configured, 401 on bad signature, 200 + idempotent on replay", async () => {
    const t = await createTenant(svc);
    expect((await createApiApp(svc).request("/billing/webhooks/stripe", { method: "POST", body: "{}" })).status).toBe(503);
    const app = createApiApp({ ...svc, config: cfg });
    const body = JSON.stringify(event("checkout.session.completed", { client_reference_id: t.organization.id, customer: "cus_http", subscription: "sub_http" }));
    expect((await app.request("/billing/webhooks/stripe", { method: "POST", body, headers: { "stripe-signature": sign(body, undefined, "whsec_wrong") } })).status).toBe(401);
    const ok = await app.request("/billing/webhooks/stripe", { method: "POST", body, headers: { "stripe-signature": sign(body) } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ result: "processed" });
    const again = await app.request("/billing/webhooks/stripe", { method: "POST", body, headers: { "stripe-signature": sign(body) } });
    expect(await again.json()).toMatchObject({ result: "duplicate" });
  });
});

describe("platform admin", () => {
  it("only super admins can change plans, limits and org overrides; every change is audited", async () => {
    const t = await createTenant(svc, { plan: "pro" });
    await expect(adminListOrganizations(svc.db, t.actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await svc.db.update(schema.users).set({ isSuperAdmin: true }).where(eq(schema.users.id, t.user.id));
    const admin = (await buildUserActor(svc.db, t.user.id, t.organization.id))!;
    const other = await createTenant(svc, { plan: "starter" });
    const list = await adminListOrganizations(svc.db, admin);
    expect(list.find((o) => o.id === other.organization.id)).toMatchObject({ plan: "starter", channels: 1 });
    await adminSetOrganizationPlan(svc.db, admin, other.organization.id, { planCode: "pro", limitOverrides: { channels: 25, apiRequestsPerMonth: "50000" } });
    const ent = await getEntitlements(svc.db, other.organization.id);
    expect(ent.planCode).toBe("pro");
    expect(ent.limits.channels).toBe(25);
    expect(ent.limits.apiRequestsPerMonth).toBe(50000);
    await expect(adminSetOrganizationPlan(svc.db, admin, other.organization.id, { limitOverrides: { channels: -1 } })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await adminUpdatePlan(svc.db, admin, "starter", { monthlyPriceCents: 2400, limits: { channels: 4 }, features: ["independent_reel_cover", "first_comment", "not_a_feature"] });
    const [plan] = await svc.db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.code, "starter"));
    expect(plan).toMatchObject({ monthlyPriceCents: 2400, features: ["independent_reel_cover", "first_comment"] });
    expect((plan!.limits as Record<string, number>).channels).toBe(4);
    const audits = await svc.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "admin.subscription_changed"));
    expect(audits.length).toBeGreaterThan(0);
    // restore seed values for other tests
    await adminUpdatePlan(svc.db, admin, "starter", { monthlyPriceCents: 1900, limits: { channels: 3 }, features: ["independent_reel_cover"] });
  });
});

describe("white-label", () => {
  it("plan-gated branding, DNS TXT domain verification, public view disappears after downgrade", async () => {
    const pro = await createTenant(svc, { plan: "pro" });
    await expect(updateBranding(svc.db, pro.actor, { appName: "Agentur X" })).rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    const t = await createTenant(svc, { plan: "enterprise" });
    const logo = await uploadAsset(svc, t.actor, t.workspace.id, "image");
    await expect(updateBranding(svc.db, t.actor, { accentColor: "red" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await updateBranding(svc.db, t.actor, { appName: "Studio Nord", logoAssetId: logo.id, accentColor: "#0f8a47", hidePoweredBy: true });
    expect(await publicBranding(svc.db, t.organization.id)).toEqual({ appName: "Studio Nord", logoAssetId: logo.id, accentColor: "#0f8a47", hidePoweredBy: true });

    await expect(setCustomDomain(svc.db, t.actor, "app.sichttakt.de")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const d = await setCustomDomain(svc.db, t.actor, "https://Social.Studio-Nord.de/");
    expect(d.customDomain).toBe("social.studio-nord.de");
    const miss = await verifyCustomDomain(svc.db, t.actor, async () => [["something-else"]]);
    expect(miss).toMatchObject({ verified: false, expected: { name: "_sichttakt.social.studio-nord.de", type: "TXT", value: d.domainToken } });
    const asked: string[] = [];
    const hit = await verifyCustomDomain(svc.db, t.actor, async (name) => {
      asked.push(name);
      return [[d.domainToken!.slice(0, 10), d.domainToken!.slice(10)]]; // long TXT records come in chunks
    });
    expect(hit).toEqual({ verified: true });
    expect(asked).toEqual(["_sichttakt.social.studio-nord.de"]);
    // a verified domain cannot be claimed by another org
    const t2 = await createTenant(svc, { plan: "enterprise" });
    await expect(setCustomDomain(svc.db, t2.actor, "social.studio-nord.de")).rejects.toMatchObject({ code: "CONFLICT" });

    await svc.db.update(schema.subscriptions).set({ planCode: "agency" }).where(eq(schema.subscriptions.organizationId, t.organization.id));
    expect(await publicBranding(svc.db, t.organization.id)).toEqual({});
  });
});

describe("manual publish companion", () => {
  it("notification target → confirmed by the user → PUBLISHED with permalink; other states refused", async () => {
    const t = await createTenant(svc);
    const { post } = await createPost(svc.db, svc.registry, t.actor, { workspace_id: t.workspace.id, account_ids: [t.channel.id], type: "text", caption: "Bitte manuell posten", media_asset_ids: [], status: "scheduled", scheduled_at: inMinutes(5).toISOString(), publish_mode: "notification" } as never);
    let target = (await getPost(svc.db, t.actor, post.id)).targets[0]!;
    await expect(markTargetPublishedManually(svc.db, t.actor, target.id)).rejects.toMatchObject({ code: "CONFLICT" }); // still SCHEDULED
    const deps: PublisherDeps = { db: svc.db, ring: svc.ring, registry: svc.registry, storage: svc.storage, mediaUrlTtlSeconds: 600, pollIntervalMs: 0, sleep: async () => {} };
    const at = inMinutes(6);
    const [job] = (await claimJobs(svc.db, "w", { now: at, kinds: ["publish_target"], limit: 200 })).filter((j) => j.organizationId === t.organization.id);
    expect(await processPublishJob({ ...deps, now: () => at }, job!)).toBe("notification_sent");
    await expect(markTargetPublishedManually(svc.db, t.actor, target.id, { permalink: "javascript:alert(1)" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const other = await createTenant(svc);
    await expect(markTargetPublishedManually(svc.db, other.actor, target.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await markTargetPublishedManually(svc.db, t.actor, target.id, { permalink: "https://instagram.com/p/abc" });
    const r = await getPost(svc.db, t.actor, post.id);
    target = r.targets[0]!;
    expect(target).toMatchObject({ status: "PUBLISHED", permalink: "https://instagram.com/p/abc" });
    expect(r.post.status).toBe("PUBLISHED");
    const audits = await svc.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, target.id));
    expect(audits.map((a) => a.action)).toContain("post.published_manually");
    await expect(markTargetPublishedManually(svc.db, t.actor, target.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
