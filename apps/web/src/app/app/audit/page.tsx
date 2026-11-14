import { ScrollText } from "lucide-react";
import { desc, eq, schema } from "@sichttakt/db";
import { authorize } from "@sichttakt/core";
import { PageHeader, Empty } from "@/components/ui";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext } from "@/lib/server";

export const metadata = { title: "Audit-Log" };

export default async function AuditPage() {
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  authorize(ctx.actor, null, "org.audit.read");
  const rows = await ctx.svc.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.organizationId, ctx.organization.id)).orderBy(desc(schema.auditLogs.createdAt)).limit(200);
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "short", timeStyle: "medium", timeZone: ctx.workspace.timezone });
  return (
    <>
      <PageHeader title={t.audit.title} subtitle="Unveränderliches Protokoll aller sicherheitsrelevanten Aktionen (letzte 200)." />
      {rows.length === 0 ? (
        <Empty icon={ScrollText} title={t.common.none} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line bg-surface-2/60 text-xs uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-5 py-3">{t.audit.time}</th>
                <th className="px-5 py-3">{t.audit.action}</th>
                <th className="px-5 py-3">{t.audit.actor}</th>
                <th className="px-5 py-3">{t.audit.target}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-2.5 whitespace-nowrap tabular-nums text-ink-2">{df.format(r.createdAt)}</td>
                  <td className="px-5 py-2.5 font-mono text-xs font-semibold">{r.action}</td>
                  <td className="px-5 py-2.5 text-xs">
                    <span className="chip bg-surface-2 text-ink-2">{r.actorType}</span>
                  </td>
                  <td className="px-5 py-2.5 font-mono text-xs text-ink-3">
                    {r.targetType ? `${r.targetType}:${r.targetId?.slice(0, 8)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
