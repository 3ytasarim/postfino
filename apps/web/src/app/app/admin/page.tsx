import { notFound } from "next/navigation";
import { asc, schema } from "@sichttakt/db";
import { adminListOrganizations, adminStats } from "@sichttakt/core";
import { PLAN_FEATURES } from "@sichttakt/shared";
import { PageHeader, Notice, Stat } from "@/components/ui";
import { FormAction } from "@/components/form-action";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext } from "@/lib/server";
import { adminOrgAction, adminPlanAction } from "../actions-billing";

export const metadata = { title: "Plattform-Admin", robots: { index: false } };

const LIMITS = ["channels", "users", "workspaces", "apiRequestsPerMonth", "apiRequestsPerMinute", "apiKeys", "aiRequestsPerMonth"] as const;
const STATUSES = ["trialing", "active", "past_due", "unpaid", "paused", "cancelled"];

export default async function AdminPage() {
  const ctx = await requireContext();
  // Not even the existence of this page is revealed to non-admins.
  if (ctx.actor.kind !== "user" || !ctx.actor.isSuperAdmin) notFound();
  const { t, locale } = await getMessages();
  const a = t.adminPage;
  const [plans, orgs, stats] = await Promise.all([ctx.svc.db.select().from(schema.subscriptionPlans).orderBy(asc(schema.subscriptionPlans.monthlyPriceCents)), adminListOrganizations(ctx.svc.db, ctx.actor), adminStats(ctx.svc.db, ctx.actor)]);
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" });
  const money = new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency: "EUR" });
  const count = (s: string) => stats.subscriptions.filter((x) => x.status === s).reduce((n, x) => n + x.n, 0);

  return (
    <>
      <PageHeader title={a.title} subtitle={a.subtitle} />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label={a.orgs} value={orgs.length} />
        <Stat label={t.billing.status_active} value={count("active")} tone="ok" />
        <Stat label={t.billing.status_trialing} value={count("trialing")} tone="puls" />
        <Stat label={a.deadJobs} value={stats.deadJobs} tone="bad" />
      </div>

      <section className="mb-8">
        <h2 className="eyebrow mb-3">{a.plans}</h2>
        <div className="grid gap-4 xl:grid-cols-2">
          {plans.map((p) => {
            const l = p.limits as Record<string, number | null>;
            return (
              <details key={p.code} className="card p-5">
                <summary className="cursor-pointer text-lg font-bold">
                  {p.name} <span className="ml-2 text-sm font-medium text-ink-3">{p.monthlyPriceCents === null ? t.billing.onRequest : money.format(p.monthlyPriceCents / 100)}</span>
                </summary>
                <FormAction action={adminPlanAction} submit={a.save} className="mt-4 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="code" value={p.code} />
                  <label className="text-sm sm:col-span-2">
                    {a.price}
                    <input name="price" type="number" min={0} step={1} defaultValue={p.monthlyPriceCents ?? ""} className="input mt-1" />
                  </label>
                  <p className="label sm:col-span-2">{a.limits}</p>
                  {LIMITS.map((k) => (
                    <label key={k} className="font-mono text-xs">
                      {k}
                      <input name={`l_${k}`} type="number" min={0} defaultValue={l[k] ?? ""} className="input mt-1" />
                    </label>
                  ))}
                  <fieldset className="sm:col-span-2">
                    <legend className="label">{a.features}</legend>
                    <div className="grid grid-cols-2 gap-1.5">
                      {PLAN_FEATURES.map((f) => (
                        <label key={f} className="flex items-center gap-2 font-mono text-xs">
                          <input type="checkbox" name="features" value={f} defaultChecked={p.features.includes(f)} className="accent-[var(--takt)]" /> {f}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </FormAction>
              </details>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="eyebrow mb-3">{a.orgs}</h2>
        <ul className="space-y-3">
          {orgs.map((o) => (
            <li key={o.id}>
              <details className="card p-5">
                <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                  <span className="font-semibold">{o.name}</span>
                  <span className="chip bg-surface-2 text-ink-2">{o.plan ?? "—"}</span>
                  <span className="chip bg-surface-2 text-ink-2">{o.status ?? "—"}</span>
                  {o.stripeManaged && <span className="chip bg-puls-soft text-puls">Stripe</span>}
                  <span className="ml-auto text-xs text-ink-3">
                    {a.channels}: {o.channels} · {a.members}: {o.members} · {df.format(o.createdAt)}
                  </span>
                </summary>
                {o.stripeManaged && (
                  <div className="mt-3">
                    <Notice tone="warn">{a.stripeWarn}</Notice>
                  </div>
                )}
                <FormAction action={adminOrgAction} submit={a.save} className="mt-4 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="organizationId" value={o.id} />
                  <label className="text-sm">
                    {a.plan}
                    <select name="plan" defaultValue={o.plan ?? ""} className="input mt-1">
                      {plans.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    {a.status}
                    <select name="status" defaultValue={o.status ?? ""} className="input mt-1">
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="label sm:col-span-2">{a.overrides}</p>
                  {LIMITS.map((k) => (
                    <label key={k} className="font-mono text-xs">
                      {k}
                      <input name={`o_${k}`} type="number" min={0} defaultValue={(o.limitOverrides as Record<string, number | null>)[k] ?? ""} className="input mt-1" />
                    </label>
                  ))}
                </FormAction>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
