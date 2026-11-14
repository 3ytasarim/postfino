import { and, eq, isNull, sql, schema, count, type Db } from "@sichttakt/db";
import { rowsOf } from "./util";
import { AppError, PLAN_DEFAULTS, type PlanCode, type PlanFeature } from "@sichttakt/shared";

// Central entitlements + quota service. Enforced in services, the public API middleware
// AND the worker — never by UI hiding alone.

export type Entitlements = {
  planCode: PlanCode;
  status: string;
  features: Set<PlanFeature>;
  limits: { channels: number | null; users: number | null; workspaces: number | null; apiRequestsPerMonth: number; apiRequestsPerMinute: number; apiKeys: number; aiRequestsPerMonth: number };
  periodStart: Date;
  periodEnd: Date;
};

export async function getEntitlements(db: Db, organizationId: string): Promise<Entitlements> {
  const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, organizationId));
  if (!sub) throw new AppError("PLAN_FEATURE_UNAVAILABLE", "No subscription for organization");
  const [plan] = await db.select().from(schema.subscriptionPlans).where(eq(schema.subscriptionPlans.code, sub.planCode));
  const def = PLAN_DEFAULTS[sub.planCode];
  const limits = { ...def.limits, ...(plan?.limits ?? {}), ...sub.limitOverrides } as Entitlements["limits"];
  const features = new Set<PlanFeature>((plan?.features as PlanFeature[] | undefined) ?? def.features);
  const active = ["trialing", "active", "past_due"].includes(sub.status);
  if (!active) {
    features.delete("public_api");
    features.delete("webhooks");
  }
  return { planCode: sub.planCode, status: sub.status, features, limits, periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd };
}

export async function assertFeature(db: Db, organizationId: string, feature: PlanFeature) {
  const e = await getEntitlements(db, organizationId);
  if (!e.features.has(feature)) throw new AppError("PLAN_FEATURE_UNAVAILABLE", `Feature "${feature}" is not included in plan ${e.planCode}`, { feature, plan: e.planCode });
  return e;
}

export async function assertLimit(db: Db, organizationId: string, limit: "channels" | "workspaces" | "users" | "apiKeys") {
  const e = await getEntitlements(db, organizationId);
  const max = e.limits[limit];
  if (max === null) return;
  let used = 0;
  if (limit === "channels") {
    [{ value: used } = { value: 0 }] = await db
      .select({ value: count() })
      .from(schema.channels)
      .where(and(eq(schema.channels.organizationId, organizationId), isNull(schema.channels.disconnectedAt), eq(schema.channels.isSandbox, false)));
  } else if (limit === "workspaces") {
    [{ value: used } = { value: 0 }] = await db
      .select({ value: count() })
      .from(schema.workspaces)
      .where(and(eq(schema.workspaces.organizationId, organizationId), isNull(schema.workspaces.archivedAt)));
  } else if (limit === "users") {
    [{ value: used } = { value: 0 }] = await db.select({ value: count() }).from(schema.memberships).where(eq(schema.memberships.organizationId, organizationId));
  } else {
    [{ value: used } = { value: 0 }] = await db
      .select({ value: count() })
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.organizationId, organizationId), isNull(schema.apiKeys.revokedAt)));
  }
  if (used >= max) throw new AppError("QUOTA_EXCEEDED", `Plan limit reached: ${limit} (${used}/${max})`, { limit, used, max, plan: e.planCode });
}

export const monthStartUtc = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/**
 * Atomically counts one API request against the monthly quota. Throws 429 QUOTA_EXCEEDED with Retry-After
 * (seconds until next month) when exhausted. Returns the threshold crossed (80/100) for webhook emission.
 */
export async function consumeApiRequest(db: Db, organizationId: string, now = new Date()) {
  const e = await getEntitlements(db, organizationId);
  if (!e.features.has("public_api") || e.limits.apiRequestsPerMonth <= 0)
    throw new AppError("PLAN_FEATURE_UNAVAILABLE", `Public API is not included in plan ${e.planCode}`, { plan: e.planCode });
  const period = monthStartUtc(now);
  const limit = e.limits.apiRequestsPerMonth;
  const rows = await db.execute(sql`
    insert into usage_records (organization_id, metric, period_start, value)
    values (${organizationId}, 'api_requests', ${period.toISOString()}, 1)
    on conflict (organization_id, metric, period_start)
    do update set value = usage_records.value + 1, updated_at = now()
    where usage_records.value < ${limit}
    returning value, threshold_notified`);
  const [row] = rowsOf<{ value: string | number; threshold_notified: number }>(rows);
  if (!row) {
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    throw new AppError("QUOTA_EXCEEDED", "Monthly API request quota exhausted", { limit }, Math.ceil((next.getTime() - now.getTime()) / 1000));
  }
  const used = Number(row.value);
  const pct = (used / limit) * 100;
  let crossed: 80 | 100 | null = null;
  if (pct >= 100 && row.threshold_notified < 100) crossed = 100;
  else if (pct >= 80 && row.threshold_notified < 80) crossed = 80;
  if (crossed) {
    await db.execute(sql`update usage_records set threshold_notified = ${crossed}
      where organization_id = ${organizationId} and metric = 'api_requests' and period_start = ${period.toISOString()}`);
  }
  return { used, limit, crossed };
}

export async function getUsage(db: Db, organizationId: string, now = new Date()) {
  const e = await getEntitlements(db, organizationId);
  const period = monthStartUtc(now);
  const [r] = await db
    .select()
    .from(schema.usageRecords)
    .where(and(eq(schema.usageRecords.organizationId, organizationId), eq(schema.usageRecords.metric, "api_requests"), eq(schema.usageRecords.periodStart, period)));
  const [{ value: channels } = { value: 0 }] = await db
    .select({ value: count() })
    .from(schema.channels)
    .where(and(eq(schema.channels.organizationId, organizationId), isNull(schema.channels.disconnectedAt), eq(schema.channels.isSandbox, false)));
  return {
    plan: e.planCode,
    period_start: period.toISOString(),
    api_requests: { used: r?.value ?? 0, limit: e.limits.apiRequestsPerMonth },
    channels: { used: channels, limit: e.limits.channels },
  };
}

// In-process per-key burst limiter (token bucket). Single API process on the VPS in Phase 1;
// replaced by Redis/Postgres-backed limiter when the API is scaled horizontally (docs/ARCHITECTURE.md).
const buckets = new Map<string, { tokens: number; at: number }>();
export function takeBurstToken(key: string, perMinute: number, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
  if (perMinute <= 0) return { ok: false, retryAfter: 60 };
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return { ok: false, retryAfter: Math.ceil(((1 - b.tokens) * 60) / perMinute) };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return { ok: true };
}

/** Generic monthly counter (e.g. ai_requests). Returns false instead of throwing so callers choose the error. */
export async function tryConsumeMonthly(db: Db, organizationId: string, metric: string, limit: number, now = new Date()) {
  if (limit <= 0) return { ok: false as const, used: 0, limit };
  const period = monthStartUtc(now);
  const rows = rowsOf<{ value: string | number }>(
    await db.execute(sql`
      insert into usage_records (organization_id, metric, period_start, value)
      values (${organizationId}, ${metric}, ${period.toISOString()}, 1)
      on conflict (organization_id, metric, period_start)
      do update set value = usage_records.value + 1, updated_at = now()
      where usage_records.value < ${limit}
      returning value`),
  );
  return rows[0] ? { ok: true as const, used: Number(rows[0].value), limit } : { ok: false as const, used: limit, limit };
}
