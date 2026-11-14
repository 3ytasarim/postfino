import { Link2 } from "lucide-react";
import { listShortLinks } from "@sichttakt/core";
import { PageHeader, Empty } from "@/components/ui";
import { FormAction } from "@/components/form-action";
import { CopyButton } from "@/components/copy-button";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext } from "@/lib/server";
import { createShortLinkAction, disableShortLinkAction } from "../actions-links";

export const metadata = { title: "Kurzlinks" };

export default async function LinksPage() {
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const l = t.linksPage;
  const links = await listShortLinks(ctx.svc.db, ctx.actor, ctx.workspace.id);
  const base = (ctx.svc.config.SHORTLINK_BASE_URL ?? `${ctx.svc.config.APP_URL}/l`).replace(/\/$/, "");
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" });
  const nf = new Intl.NumberFormat(intlLocale(locale));
  return (
    <>
      <PageHeader title={l.title} subtitle={l.subtitle} />
      <section className="card mb-6 p-6">
        <FormAction action={createShortLinkAction} submit={l.create} className="flex flex-col gap-3 sm:flex-row sm:items-end" resetOnSuccess>
          <div className="flex-1">
            <label className="label" htmlFor="sl-url">
              {l.url}
            </label>
            <input id="sl-url" name="url" type="url" className="input" placeholder="https://shop.example.de/produkt?utm_source=instagram" required />
          </div>
        </FormAction>
      </section>
      {links.length === 0 ? (
        <Empty icon={Link2} title={l.empty} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-xs text-ink-3">
              <tr>
                <th className="px-4 py-3 font-semibold">{l.short}</th>
                <th className="px-4 py-3 font-semibold">{l.target}</th>
                <th className="px-4 py-3 text-right font-semibold">{l.clicks}</th>
                <th className="px-4 py-3 font-semibold">{l.created}</th>
                <th className="px-4 py-3">
                  <span className="sr-only">{t.common.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {links.map((k) => {
                const url = `${base}/${k.code}`;
                return (
                  <tr key={k.id} className={k.disabledAt ? "opacity-50" : ""}>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <code className="font-mono text-[0.82rem]">{url.replace(/^https?:\/\//, "")}</code>
                        {!k.disabledAt && <CopyButton value={url} label={t.common.copy} done={t.common.copied} />}
                      </span>
                    </td>
                    <td className="max-w-[320px] truncate px-4 py-3 text-ink-2" title={k.targetUrl}>
                      {k.targetUrl}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{nf.format(k.clicks)}</td>
                    <td className="px-4 py-3 text-ink-3">{df.format(k.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {k.disabledAt ? (
                        <span className="chip bg-surface-2 text-ink-3">{l.disabled}</span>
                      ) : (
                        <form action={disableShortLinkAction}>
                          <input type="hidden" name="linkId" value={k.id} />
                          <button className="btn btn-ghost !min-h-[34px] text-xs">{l.disable}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
