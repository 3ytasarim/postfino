import { sql, schema, type Db } from "@sichttakt/db";
import { PLAN_DEFAULTS, PLAN_CODES } from "@sichttakt/shared";
import { seedMetricDefinitions } from "./insights";

/** Idempotent reference-data seed: plans (only inserted, never overwritten — admin edits win). */
export async function seedReferenceData(db: Db) {
  for (const code of PLAN_CODES) {
    const p = PLAN_DEFAULTS[code];
    await db
      .insert(schema.subscriptionPlans)
      .values({ code, name: p.name, monthlyPriceCents: p.monthlyPriceCents, limits: p.limits, features: p.features })
      .onConflictDoNothing();
  }
  await seedMetricDefinitions(db);
  await db.execute(sql`select 1`);
}
