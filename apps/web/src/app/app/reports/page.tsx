import { FileText } from "lucide-react";
import { listReports, listMedia, getEntitlements } from "@sichttakt/core";
import { PageHeader, Empty, Notice } from "@/components/ui";
import { FormAction } from "@/components/form-action";
import { AutoRefresh } from "@/components/auto-refresh";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext } from "@/lib/server";
import { createReportAction } from "../actions-insights";

export const metadata = { title: "Berichte" };

export default async function ReportsPage() {
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const [reports, media, ent] = await Promise.all([listReports(ctx.svc.db, ctx.actor, ctx.workspace.id), listMedia(ctx.svc.db, ctx.actor, ctx.workspace.id), getEntitlements(ctx.svc.db, ctx.organization.id)]);
  const branded = ent.features.has("branded_reports");
  const logos = media.filter((m) => m.mimeType === "image/jpeg" && m.status === "ready");
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const hasPending = reports.some((r) => r.status === "pending" || r.status === "running");

  return (
    <>
      <AutoRefresh active={hasPending} />
      <PageHeader title={t.reportsPage.title} subtitle={t.reportsPage.subtitle} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr] [&>*]:min-w-0">
        <section className="card h-fit p-6">
          <h2 className="mb-4 font-bold">{t.reportsPage.create}</h2>
          <FormAction action={createReportAction} submit={t.reportsPage.create} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold text-ink-2 sm:col-span-2">
              {t.reportsPage.reportTitle}
              <input name="title" required defaultValue={`${ctx.workspace.name} – Social Report`} className="input mt-1" />
            </label>
            <label className="text-sm font-semibold text-ink-2">
              {t.reportsPage.from}
              <input name="from" type="date" required defaultValue={monthAgo} className="input mt-1" />
            </label>
            <label className="text-sm font-semibold text-ink-2">
              {t.reportsPage.to}
              <input name="to" type="date" required defaultValue={today} className="input mt-1" />
            </label>
            <label className="text-sm font-semibold text-ink-2">
              {t.reportsPage.format}
              <select name="format" className="input mt-1" defaultValue="pdf">
                <option value="pdf">PDF</option>
                <option value="csv">CSV (ZIP)</option>
                <option value="md">Markdown</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-ink-2">
              {t.common.language}
              <select name="locale" className="input mt-1" defaultValue={locale}>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
                <option value="tr">Türkçe</option>
              </select>
            </label>
            {branded ? (
              <>
                <label className="text-sm font-semibold text-ink-2">
                  {t.reportsPage.logo}
                  <select name="logoAssetId" className="input mt-1">
                    <option value="">{t.reportsPage.noLogo}</option>
                    {logos.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.originalFilename}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-ink-2">
                  {t.reportsPage.footer}
                  <input name="footer" maxLength={120} className="input mt-1" />
                </label>
              </>
            ) : (
              <div className="sm:col-span-2">
                <Notice tone="info">{t.reportsPage.brandedLocked}</Notice>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-2">
              <input type="checkbox" name="takeaways" defaultChecked className="size-4 accent-[var(--takt)]" /> {t.reportsPage.takeaways}
            </label>
          </FormAction>
        </section>
        <section className="card overflow-hidden">
          {reports.length === 0 ? (
            <div className="p-6">
              <Empty icon={FileText} title={t.common.none} />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {reports.map((r) => {
                const cfg = r.config as { from?: string; to?: string };
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-6 py-3">
                    <span className="chip bg-surface-2 font-mono text-ink-2 uppercase">{r.format}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{r.title}</p>
                      <p className="text-xs text-ink-3">
                        {cfg.from?.slice(0, 10)} – {cfg.to?.slice(0, 10)} · {df.format(r.createdAt)}
                      </p>
                      {r.error && <p className="text-xs text-bad">{r.error}</p>}
                    </div>
                    {r.status === "ready" ? (
                      <a href={`/app/api/reports/${r.id}`} className="btn btn-primary !min-h-[36px] text-sm">
                        {t.reportsPage.download}
                      </a>
                    ) : (
                      <span className={`chip ${r.status === "failed" ? "bg-bad-soft text-bad" : "bg-puls-soft text-puls"}`}>{r.status === "failed" ? r.status : t.reportsPage.pending}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
