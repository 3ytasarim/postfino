import { asc, count, eq, isNull, sql, schema, type Db } from "@sichttakt/db";
import { AppError, PLAN_DEFAULTS, PLAN_FEATURES, type PlanCode, type PlanFeature } from "@sichttakt/shared";
import { audit } from "./audit";
import type { Actor } from "./rbac";

// Platform administration (super admins of Bleibsichtbar only). All plans and limits are editable here:
// plan prices/limits/features and per-organisation plan, status and limit
// overrides (paid add-ons, goodwill extras). Every change is audited. Organisations billed through Stripe get
// their plan/status from webhooks; a manual change there is overwritten by the next subscription event.

const LIMIT_KEYS = ["channels", "users", "workspaces", "apiRequestsPerMonth", "apiRequestsPerMinute", "apiKeys", "aiRequestsPerMonth"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export function assertSuperAdmin(actor: Actor) {
  if (actor.kind !== "user" || !actor.isSuperAdmin) throw new AppError("FORBIDDEN", "platform_admin_only");
}

function cleanLimits(input: Record<string, unknown>) {
  const out: Record<string, number | null> = {};
  for (const k of LIMIT_KEYS) {
    if (!(k in input)) continue;
    const v = input[k];
    if (v === null || v === "") out[k] = null;
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 100_000_000) throw new AppError("VALIDATION_FAILED", `invalid_limit_${k}`);
      out[k] = n;
    }
  }
  return out;
}

export async function adminListOrganizations(db: Db, actor: Actor) {
  assertSuperAdmin(actor);
  const rows = await db
    .select({ org: schema.organizations, sub: schema.subscriptions })
    .from(schema.organizations)
    .leftJoin(schema.subscriptions, eq(schema.subscriptions.organizationId, schema.organizations.id))
    .where(isNull(schema.organizations.deletedAt))
    .orderBy(asc(schema.organizations.name))
    .limit(500);
  const channels = await db.select({ org: schema.channels.organizationId, n: count() }).from(schema.channels).where(isNull(schema.channels.disconnectedAt)).groupBy(schema.channels.organizationId);
  const members = await db.select({ org: schema.memberships.organizationId, n: count() }).from(schema.memberships).groupBy(schema.memberships.organizationId);
  const by = (list: { org: string; n: number }[], id: string) => list.find((x) => x.org === id)?.n ?? 0;
  return rows.map((r) => ({
    id: r.org.id,
    name: r.org.name,
    createdAt: r.org.createdAt,
    plan: r.sub?.planCode ?? null,
    status: r.sub?.status ?? null,
    stripeManaged: Boolean(r.sub?.externalSubscriptionId),
    limitOverrides: r.sub?.limitOverrides ?? {},
    channels: by(channels, r.org.id),
    members: by(members, r.org.id),
  }));
}

export async function adminSetOrganizationPlan(db: Db, actor: Actor, organizationId: string, p: { planCode?: PlanCode; status?: string; limitOverrides?: Record<string, unknown> }) {
  assertSuperAdmin(actor);
  const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, organizationId));
  if (!sub) throw new AppError("NOT_FOUND", "Subscription not found");
  if (p.planCode && !(p.planCode in PLAN_DEFAULTS)) throw new AppError("VALIDATION_FAILED", "unknown_plan");
  if (p.status && !["trialing", "active", "past_due", "unpaid", "paused", "cancelled"].includes(p.status)) throw new AppError("VALIDATION_FAILED", "unknown_status");
  const overrides = p.limitOverrides ? cleanLimits(p.limitOverrides) : undefined;
  await db
    .update(schema.subscriptions)
    .set({ ...(p.planCode ? { planCode: p.planCode } : {}), ...(p.status ? { status: p.status } : {}), ...(overrides ? { limitOverrides: overrides } : {}), updatedAt: new Date() })
    .where(eq(schema.subscriptions.id, sub.id));
  await audit(db, { organizationId, actor, action: "admin.subscription_changed", metadata: { from: { plan: sub.planCode, status: sub.status, overrides: sub.limitOverrides }, to: { plan: p.planCode, status: p.status, overrides } } });
}

export async function adminUpdatePlan(db: Db, actor: Actor, code: PlanCode, p: { monthlyPriceCents?: number | null; limits?: Record<string, unknown>; features?: string[] }) {
  assertSuperAdmin(actor);
  const [plan] = await db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.code, code));
  if (!plan) throw new AppError("NOT_FOUND", "Plan not found");
  if (p.monthlyPriceCents !== undefined && p.monthlyPriceCents !== null && (!Number.isInteger(p.monthlyPriceCents) || p.monthlyPriceCents < 0)) throw new AppError("VALIDATION_FAILED", "invalid_price");
  const features = p.features?.filter((f): f is PlanFeature => (PLAN_FEATURES as readonly string[]).includes(f));
  await db
    .update(schema.subscriptionPlans)
    .set({
      ...(p.monthlyPriceCents !== undefined ? { monthlyPriceCents: p.monthlyPriceCents } : {}),
      ...(p.limits ? { limits: { ...(plan.limits as Record<string, number | null>), ...cleanLimits(p.limits) } } : {}),
      ...(features ? { features } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.subscriptionPlans.code, code));
  await audit(db, { organizationId: null, actor, action: "admin.plan_changed", metadata: { plan: code, price: p.monthlyPriceCents, limits: p.limits, features } });
}

export async function adminStats(db: Db, actor: Actor) {
  assertSuperAdmin(actor);
  const rows = await db.select({ plan: schema.subscriptions.planCode, status: schema.subscriptions.status, n: count() }).from(schema.subscriptions).groupBy(schema.subscriptions.planCode, schema.subscriptions.status);
  const [dead] = await db.select({ n: count() }).from(schema.queueItems).where(sql`${schema.queueItems.status} = 'dead'`);
  return { subscriptions: rows, deadJobs: dead?.n ?? 0 };
}
