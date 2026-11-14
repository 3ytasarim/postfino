import { Check, ExternalLink, FileText } from "lucide-react";
import { asc, eq, schema } from "@sichttakt/db";
import { getEntitlements, getUsage, authorize, listInvoices, isBillingConfigured } from "@sichttakt/core";
import { PageHeader, Notice } from "@/components/ui";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext } from "@/lib/server";
import { checkoutAction, portalAction } from "../actions-billing";

export const metadata = { title: "Tarif & Nutzung" };

const FEATURE_LABEL: Record<string, string> = {
  public_api: "Public API",
  webhooks: "Webhooks (HMAC)",
  team: "Team",
  client_workspaces: "Kunden-Workspaces",
  approvals: "Freigabe-Workflow",
  branded_reports: "Gebrandete Berichte",
  independent_reel_cover: "Eigenes Reels-Cover*",
  first_comment: "Erster Kommentar",
  sso: "SSO",
  white_label: "White-Label",
  ip_allowlist: "IP-Allowlist",
};
const STATUS_TONE: Record<string, string> = { active: "bg-ok-soft text-ok", trialing: "bg-puls-soft text-puls", past_due: "bg-warn-soft text-warn", unpaid: "bg-bad-soft text-bad", cancelled: "bg-bad-soft text-bad", paused: "bg-surface-2 text-ink-2" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const b = t.billing;
  authorize(ctx.actor, null, "org.billing");
  const [plans, ent, usage, invoices, [sub]] = await Promise.all([
    ctx.svc.db.select().from(schema.subscriptionPlans).orderBy(asc(schema.subscriptionPlans.monthlyPriceCents)),
    getEntitlements(ctx.svc.db, ctx.organization.id),
    getUsage(ctx.svc.db, ctx.organization.id),
    listInvoices(ctx.svc.db, ctx.actor),
    ctx.svc.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, ctx.organization.id)),
  ]);
  const configured = isBillingConfigured(ctx.svc.config);
  const stripeManaged = Boolean(sub?.externalSubscriptionId);
  const money = new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const money2 = (cents: number, cur: string) => new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency: cur }).format(cents / 100);
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" });
  const nf = new Intl.NumberFormat(intlLocale(locale));
  const sorted = [...plans].sort((a, b) => (a.monthlyPriceCents ?? Infinity) - (b.monthlyPriceCents ?? Infinity));
  const statusLabel = (b as Record<string, string>)[`status_${ent.status}`] ?? ent.status;

  return (
    <>
      <PageHeader
        title={b.title}
        subtitle={`${b.current}: ${ent.planCode.toUpperCase()}`}
        actions={
          stripeManaged && configured ? (
            <form action={portalAction}>
              <button className="btn btn-primary">
                <ExternalLink className="size-4" /> {b.manage}
              </button>
            </form>
          ) : undefined
        }
      />
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className={`chip ${STATUS_TONE[ent.status] ?? "bg-surface-2 text-ink-2"}`}>{statusLabel}</span>
          <span className="text-ink-2">
            {b.periodEnds}: {df.format(ent.periodEnd)}
          </span>
          {stripeManaged && <span className="chip bg-surface-2 text-ink-2">{b.stripeManaged}</span>}
        </div>
        {sp.checkout === "success" && <Notice tone="ok">{b.checkoutSuccess}</Notice>}
        {sp.checkout === "cancelled" && <Notice tone="info">{b.checkoutCancelled}</Notice>}
        {sp.error && <Notice tone="bad">{sp.error}</Notice>}
        {!configured && <Notice tone="warn">{b.notConfigured}</Notice>}
        <p className="text-xs text-ink-3">
          {b.draftNote} {b.taxNote}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {sorted.map((p) => {
          const current = p.code === ent.planCode;
          const l = p.limits as Record<string, number | null>;
          return (
            <section key={p.code} className={`card relative flex flex-col p-6 ${current ? "ring-2 ring-takt" : ""}`} aria-current={current ? "true" : undefined}>
              {p.code === "pro" && <span className="chip absolute -top-3 left-6 bg-takt text-takt-ink">API</span>}
              <h2 className="text-xl font-bold">{p.name}</h2>
              <p className="mt-3 font-display text-3xl font-bold">
                {p.monthlyPriceCents === null ? b.onRequest : money.format(p.monthlyPriceCents / 100)}
                {p.monthlyPriceCents !== null && <span className="ml-1 text-sm font-medium text-ink-3">{b.perMonth}</span>}
              </p>
              <dl className="mt-5 space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-2">{b.channels}</dt>
                  <dd className="text-right font-semibold">{l.channels ?? b.unlimited}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-2">{b.users}</dt>
                  <dd className="text-right font-semibold">{l.users ?? b.unlimited}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-2">{b.apiRequests}</dt>
                  <dd className="text-right font-semibold">{l.apiRequestsPerMonth ? nf.format(l.apiRequestsPerMonth) : b.noApi}</dd>
                </div>
              </dl>
              <ul className="mt-5 flex-1 space-y-1.5 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="size-4 text-ok" aria-hidden /> {FEATURE_LABEL[f] ?? f}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {current ? (
                  <p className="chip w-fit bg-takt-soft text-takt">{b.current}</p>
                ) : p.code === "enterprise" ? (
                  ctx.svc.config.SALES_CONTACT_EMAIL ? (
                    <a href={`mailto:${ctx.svc.config.SALES_CONTACT_EMAIL}?subject=Postfino%20Enterprise`} className="btn btn-ghost w-full">
                      {b.contact}
                    </a>
                  ) : null
                ) : configured ? (
                  <form action={stripeManaged ? portalAction : checkoutAction}>
                    <input type="hidden" name="plan" value={p.code} />
                    <button className="btn btn-primary w-full">{stripeManaged ? b.switch : b.choose}</button>
                  </form>
                ) : (
                  <button className="btn btn-ghost w-full" disabled title={b.notConfigured}>
                    {b.choose}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <section className="card mt-6 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
          <FileText className="size-5" /> {b.invoices}
        </h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-ink-3">{b.noInvoices}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-line text-left text-xs text-ink-3">
                <tr>
                  <th className="py-2 pr-3 font-semibold">{b.number}</th>
                  <th className="py-2 pr-3 font-semibold">{b.date}</th>
                  <th className="py-2 pr-3 text-right font-semibold">{b.amount}</th>
                  <th className="py-2 pr-3 font-semibold">{t.common.status}</th>
                  <th className="py-2">
                    <span className="sr-only">{t.common.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2 pr-3 font-mono text-xs">{i.number ?? i.externalId}</td>
                    <td className="py-2 pr-3 text-ink-2">{df.format(i.issuedAt)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money2(i.status === "paid" ? i.amountPaidCents : i.amountDueCents, i.currency)}</td>
                    <td className="py-2 pr-3">
                      <span className={`chip ${i.status === "paid" ? "bg-ok-soft text-ok" : i.status === "open" ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2"}`}>{i.status}</span>
                    </td>
                    <td className="py-2 text-right">
                      {i.hostedUrl && (
                        <a href={i.hostedUrl} target="_blank" rel="noreferrer" className="text-takt underline underline-offset-2">
                          {b.open}
                        </a>
                      )}
                      {i.pdfUrl && (
                        <a href={i.pdfUrl} target="_blank" rel="noreferrer" className="ml-3 text-takt underline underline-offset-2">
                          {b.pdf}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card mt-6 p-6 text-sm">
        <h2 className="mb-3 font-bold">{t.developer.usage}</h2>
        <p>
          {b.channels}: <strong>{usage.channels.used}</strong> / {usage.channels.limit ?? "∞"} · {t.developer.requests}: <strong>{nf.format(usage.api_requests.used)}</strong> / {nf.format(usage.api_requests.limit)}
        </p>
        <p className="mt-3 text-xs text-ink-3">
          * Eigenes Reels-Cover: Tarif-Freischaltung ≠ Plattform-Garantie. Automatische Veröffentlichung erst nach bestandenem Live-PoC. API-Anfragekontingent ≠ Anzahl erfolgreicher Social-Media-Veröffentlichungen; Limits der Netzwerke gelten zusätzlich.
        </p>
      </section>
    </>
  );
}
