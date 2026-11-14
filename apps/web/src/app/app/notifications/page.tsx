import Link from "next/link";
import { Bell } from "lucide-react";
import { and, desc, eq, schema } from "@sichttakt/db";
import { PageHeader, Empty } from "@/components/ui";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext } from "@/lib/server";
import { markNotificationsReadAction } from "../actions";

export const metadata = { title: "Benachrichtigungen" };

export default async function NotificationsPage() {
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const rows = await ctx.svc.db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, ctx.user.id), eq(schema.notifications.organizationId, ctx.organization.id)))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(100);
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
  return (
    <>
      <PageHeader
        title="Benachrichtigungen"
        actions={
          <form action={markNotificationsReadAction}>
            <button className="btn btn-ghost">Alle gelesen</button>
          </form>
        }
      />
      {rows.length === 0 ? (
        <Empty icon={Bell} title={t.common.none} />
      ) : (
        <ul className="card divide-y divide-line">
          {rows.map((n) => (
            <li key={n.id} className="flex items-start gap-3 px-5 py-4">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-line" : "bg-takt"}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{n.link ? <Link href={n.link} className="hover:text-takt">{n.title}</Link> : n.title}</p>
                {n.body && <p className="mt-0.5 truncate text-sm text-ink-2">{n.body}</p>}
              </div>
              <time className="text-xs whitespace-nowrap text-ink-3">{df.format(n.createdAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
