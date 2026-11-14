import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, schema, type Db } from "@sichttakt/db";
import { AppError, type PlanCode } from "@sichttakt/shared";
import type { AppConfig } from "@sichttakt/config";
import { authorize } from "./tenancy";
import { audit } from "./audit";
import type { Actor } from "./rbac";

// Billing. Stripe is the payment provider: Checkout for new subscriptions, the Customer Portal
// for payment methods / plan changes / cancellation / invoices, and signed webhooks as the single source of truth
// for subscription state. No Stripe SDK — the REST API is form-encoded and small. Nothing here runs without
// STRIPE_SECRET_KEY; going live (real charges) needs explicit approval.

type Fetch = typeof fetch;
const PLAN_ENV: Record<Exclude<PlanCode, "enterprise">, keyof AppConfig> = { starter: "STRIPE_PRICE_STARTER", pro: "STRIPE_PRICE_PRO", agency: "STRIPE_PRICE_AGENCY" };

export function isBillingConfigured(c: AppConfig) {
  return Boolean(c.STRIPE_SECRET_KEY && c.STRIPE_WEBHOOK_SECRET);
}

/** Flattens nested objects into Stripe's form encoding: a[b][0][c]=… */
export function stripeForm(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? stripeForm(x as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === "object") stripeForm(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export class StripeBilling {
  private readonly http: Fetch;
  constructor(private readonly config: AppConfig, http?: Fetch) {
    this.http = http ?? fetch;
  }

  priceFor(plan: PlanCode): string {
    if (plan === "enterprise") throw new AppError("VALIDATION_FAILED", "enterprise_on_request");
    const price = this.config[PLAN_ENV[plan]] as string | undefined;
    if (!price) throw new AppError("PROVIDER_NOT_CONFIGURED", `${PLAN_ENV[plan]} is not configured`);
    return price;
  }

  planForPrice(priceId: string): PlanCode | null {
    for (const [plan, env] of Object.entries(PLAN_ENV)) if (this.config[env] === priceId) return plan as PlanCode;
    return null;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
    if (!this.config.STRIPE_SECRET_KEY) throw new AppError("PROVIDER_NOT_CONFIGURED", "STRIPE_SECRET_KEY is not configured");
    const res = await this.http(`https://api.stripe.com/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${this.config.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
      body: body ? stripeForm(body).toString() : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } } & T;
    if (!res.ok) throw new AppError(res.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR", `stripe: ${j.error?.message ?? res.status}`, { provider_code: j.error?.code });
    return j;
  }

  /** Checkout session for a new subscription (card, SEPA debit etc. as enabled in the Stripe dashboard). */
  createCheckout(p: { organizationId: string; plan: PlanCode; email: string; customerId?: string | null; vatCountry: string; successUrl: string; cancelUrl: string; trialDays: number; idempotencyKey: string }) {
    return this.call<{ id: string; url: string }>(
      "POST",
      "/checkout/sessions",
      {
        mode: "subscription",
        line_items: [{ price: this.priceFor(p.plan), quantity: 1 }],
        client_reference_id: p.organizationId,
        ...(p.customerId ? { customer: p.customerId, customer_update: { address: "auto", name: "auto" } } : { customer_email: p.email }),
        subscription_data: { metadata: { organization_id: p.organizationId, plan: p.plan }, ...(p.trialDays > 0 ? { trial_period_days: p.trialDays } : {}) },
        metadata: { organization_id: p.organizationId },
        billing_address_collection: "required",
        tax_id_collection: { enabled: true }, // B2B: USt-IdNr. on the invoice
        automatic_tax: { enabled: this.config.STRIPE_AUTOMATIC_TAX === "true" },
        allow_promotion_codes: true,
        locale: "de",
        success_url: p.successUrl,
        cancel_url: p.cancelUrl,
      },
      p.idempotencyKey,
    );
  }

  createPortal(p: { customerId: string; returnUrl: string }) {
    return this.call<{ url: string }>("POST", "/billing_portal/sessions", { customer: p.customerId, return_url: p.returnUrl, locale: "de" });
  }

  /** Verifies the Stripe-Signature header (HMAC-SHA256 over "t.payload", 5-minute tolerance) and parses the event. */
  verifyWebhook(rawBody: string, header: string | null, nowSec = Math.floor(Date.now() / 1000)): StripeEvent {
    const secret = this.config.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new AppError("PROVIDER_NOT_CONFIGURED", "STRIPE_WEBHOOK_SECRET is not configured");
    const parts = (header ?? "").split(",").map((x) => x.trim().split("=") as [string, string]);
    const t = Number(parts.find(([k]) => k === "t")?.[1]);
    const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
    if (!Number.isFinite(t) || sigs.length === 0) throw new AppError("UNAUTHENTICATED", "invalid_signature_header");
    if (Math.abs(nowSec - t) > 300) throw new AppError("UNAUTHENTICATED", "signature_too_old");
    const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
    const ok = sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), expected));
    if (!ok) throw new AppError("UNAUTHENTICATED", "invalid_signature");
    return JSON.parse(rawBody) as StripeEvent;
  }
}

export type StripeEvent = { id: string; type: string; data: { object: Record<string, any> } };

const STATUS: Record<string, string | null> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  unpaid: "unpaid", // retries exhausted → API/webhooks switched off by entitlements
  canceled: "cancelled",
  paused: "paused",
  incomplete: null, // checkout not finished yet: keep the current (trial) state
  incomplete_expired: null,
};

async function orgForCustomer(db: Db, customer: string | undefined, metaOrg: string | undefined) {
  if (metaOrg) {
    const [s] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, metaOrg));
    if (s) return s;
  }
  if (!customer) return null;
  const [s] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.externalCustomerId, customer));
  return s ?? null;
}

const ts = (sec: unknown) => (typeof sec === "number" ? new Date(sec * 1000) : undefined);

/**
 * Applies a verified Stripe event. Idempotent: the event id is stored first (unique), a replay is a no-op.
 * Returns what happened, for logging and tests.
 */
export async function handleStripeEvent(db: Db, stripe: StripeBilling, ev: StripeEvent): Promise<"processed" | "duplicate" | "ignored"> {
  const inserted = await db.insert(schema.billingEvents).values({ provider: "stripe", eventId: ev.id, type: ev.type }).onConflictDoNothing().returning();
  if (!inserted[0]) return "duplicate";
  const o = ev.data.object;
  const mark = (status: "processed" | "ignored", organizationId?: string, error?: string) =>
    db.update(schema.billingEvents).set({ status, organizationId, error, processedAt: new Date() }).where(eq(schema.billingEvents.id, inserted[0]!.id));

  if (ev.type === "checkout.session.completed") {
    const orgId = (o.client_reference_id ?? o.metadata?.organization_id) as string | undefined;
    const sub = orgId ? await orgForCustomer(db, undefined, orgId) : null;
    if (!sub) return mark("ignored", undefined, "unknown organization").then(() => "ignored" as const);
    await db.update(schema.subscriptions).set({ externalCustomerId: o.customer ?? sub.externalCustomerId, externalSubscriptionId: o.subscription ?? sub.externalSubscriptionId, updatedAt: new Date() }).where(eq(schema.subscriptions.id, sub.id));
    await mark("processed", sub.organizationId);
    return "processed";
  }

  if (ev.type.startsWith("customer.subscription.")) {
    const sub = await orgForCustomer(db, o.customer, o.metadata?.organization_id);
    if (!sub) return mark("ignored", undefined, "unknown customer").then(() => "ignored" as const);
    const item = o.items?.data?.[0];
    const plan = item?.price?.id ? stripe.planForPrice(item.price.id) : null;
    const status = ev.type === "customer.subscription.deleted" ? "cancelled" : STATUS[o.status as string];
    const start = ts(item?.current_period_start ?? o.current_period_start);
    const end = ts(item?.current_period_end ?? o.current_period_end);
    await db
      .update(schema.subscriptions)
      .set({
        ...(status ? { status } : {}),
        ...(plan ? { planCode: plan } : {}),
        ...(start ? { currentPeriodStart: start } : {}),
        ...(end ? { currentPeriodEnd: end } : {}),
        externalCustomerId: o.customer ?? sub.externalCustomerId,
        externalSubscriptionId: o.id ?? sub.externalSubscriptionId,
        updatedAt: new Date(),
      })
      .where(eq(schema.subscriptions.id, sub.id));
    await audit(db, { organizationId: sub.organizationId, actorType: "system", action: "billing.subscription_updated", metadata: { event: ev.type, status: status ?? `(${o.status})`, plan: plan ?? sub.planCode, unknown_price: item?.price?.id && !plan ? item.price.id : undefined } });
    await mark("processed", sub.organizationId);
    return "processed";
  }

  if (ev.type.startsWith("invoice.")) {
    const sub = await orgForCustomer(db, o.customer, o.subscription_details?.metadata?.organization_id ?? o.metadata?.organization_id);
    if (!sub) return mark("ignored", undefined, "unknown customer").then(() => "ignored" as const);
    const values = {
      organizationId: sub.organizationId,
      provider: "stripe",
      externalId: String(o.id),
      number: o.number ?? null,
      status: String(o.status ?? "open"),
      amountDueCents: Number(o.amount_due ?? 0),
      amountPaidCents: Number(o.amount_paid ?? 0),
      currency: String(o.currency ?? "eur").toUpperCase(),
      hostedUrl: o.hosted_invoice_url ?? null,
      pdfUrl: o.invoice_pdf ?? null,
      periodStart: ts(o.period_start) ?? null,
      periodEnd: ts(o.period_end) ?? null,
      issuedAt: ts(o.created) ?? new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.invoices).values(values).onConflictDoUpdate({ target: [schema.invoices.provider, schema.invoices.externalId], set: values });
    if (ev.type === "invoice.payment_failed") {
      await db.update(schema.subscriptions).set({ status: "past_due", updatedAt: new Date() }).where(eq(schema.subscriptions.id, sub.id));
      const owners = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.organizationId, sub.organizationId), eq(schema.memberships.role, "AGENCY_OWNER")));
      for (const ow of owners)
        if (ow.userId) await db.insert(schema.notifications).values({ organizationId: sub.organizationId, userId: ow.userId, kind: "billing_payment_failed", title: "Zahlung fehlgeschlagen", body: "Bitte Zahlungsmethode im Kundenportal aktualisieren. API und Webhooks bleiben bis zum Ende der Mahnphase aktiv.", link: "/app/billing" });
    }
    await mark("processed", sub.organizationId);
    return "processed";
  }

  await mark("ignored");
  return "ignored";
}

/** Owner/admin starts checkout (no Stripe subscription yet) — or the portal when one exists. */
export async function startCheckout(db: Db, stripe: StripeBilling, actor: Actor, p: { plan: PlanCode; email: string; appUrl: string; trialDays: number }) {
  authorize(actor, null, "org.billing");
  const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, actor.organizationId));
  if (!sub) throw new AppError("NOT_FOUND", "No subscription");
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, actor.organizationId));
  if (sub.externalSubscriptionId && ["active", "trialing", "past_due"].includes(sub.status) && sub.externalCustomerId) {
    return stripe.createPortal({ customerId: sub.externalCustomerId, returnUrl: `${p.appUrl}/app/billing` });
  }
  const session = await stripe.createCheckout({
    organizationId: actor.organizationId,
    plan: p.plan,
    email: p.email,
    customerId: sub.externalCustomerId,
    vatCountry: org?.country ?? "DE",
    successUrl: `${p.appUrl}/app/billing?checkout=success`,
    cancelUrl: `${p.appUrl}/app/billing?checkout=cancelled`,
    // only the first paid subscription gets a trial
    trialDays: sub.externalCustomerId ? 0 : p.trialDays,
    idempotencyKey: `checkout:${actor.organizationId}:${p.plan}:${new Date().toISOString().slice(0, 13)}`,
  });
  await audit(db, { organizationId: actor.organizationId, actor, action: "billing.checkout_started", metadata: { plan: p.plan } });
  return { url: session.url };
}

export async function openBillingPortal(db: Db, stripe: StripeBilling, actor: Actor, appUrl: string) {
  authorize(actor, null, "org.billing");
  const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, actor.organizationId));
  if (!sub?.externalCustomerId) throw new AppError("CONFLICT", "no_billing_customer");
  return stripe.createPortal({ customerId: sub.externalCustomerId, returnUrl: `${appUrl}/app/billing` });
}

export async function listInvoices(db: Db, actor: Actor) {
  authorize(actor, null, "org.billing");
  return db.select().from(schema.invoices).where(eq(schema.invoices.organizationId, actor.organizationId)).orderBy(desc(schema.invoices.issuedAt)).limit(50);
}
