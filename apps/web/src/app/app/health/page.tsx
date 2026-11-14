import Link from "next/link";
import { and, desc, eq, schema } from "@sichttakt/db";
import { authorize } from "@sichttakt/core";
import { PageHeader, Notice } from "@/components/ui";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext } from "@/lib/server";
import { replayJobAction } from "../actions";

export const metadata = { title: "Systemzustand" };

export default async function HealthPage() {
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  authorize(ctx.actor, null, "org.manage");
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
  const [creds, dead] = await Promise.all([
    ctx.svc.db
      .select({ ch: schema.channels, expiresAt: schema.channelCredentials.expiresAt, revokedAt: schema.channelCredentials.revokedAt })
      .from(schema.channels)
      .leftJoin(schema.channelCredentials, eq(schema.channelCredentials.channelId, schema.channels.id))
      .where(eq(schema.channels.organizationId, ctx.organization.id)),
    ctx.svc.db
      .select()
      .from(schema.queueItems)
      .where(and(eq(schema.queueItems.organizationId, ctx.organization.id), eq(schema.queueItems.status, "dead")))
      .orderBy(desc(schema.queueItems.updatedAt))
      .limit(100),
  ]);
  const soon = Date.now() + 10 * 864e5;
  const postIdOf = async (targetId: string) => (await ctx.svc.db.select({ postId: schema.postTargets.postId }).from(schema.postTargets).where(eq(schema.postTargets.id, targetId)))[0]?.postId;
  const deadRows = await Promise.all(dead.map(async (j) => ({ j, postId: j.kind === "publish_target" ? await postIdOf(String(j.payload.postTargetId)) : undefined })));

  return (
    <>
      <PageHeader title={t.health.title} subtitle={t.health.subtitle} />
      <section className="card mb-6 overflow-x-auto">
        <h2 className="border-b border-line px-6 py-4 text-lg font-bold">{t.health.tokens}</h2>
        <table className="w-full min-w-[560px] text-left text-sm">
          <tbody className="divide-y divide-line">
            {creds.filter((c) => !c.ch.disconnectedAt).map(({ ch, expiresAt }) => {
              const bad = ch.status !== "active";
              const warn = !bad && expiresAt && expiresAt.getTime() < soon;
              return (
                <tr key={ch.id}>
                  <td className="px-6 py-3 font-semibold">{ch.displayName}</td>
                  <td className="px-3 py-3 font-mono text-xs text-ink-3">{ch.platform}{ch.isSandbox ? " · MOCK" : ""}</td>
                  <td className="px-3 py-3 text-xs">
                    {t.health.expires}: {expiresAt ? df.format(expiresAt) : "—"}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`chip ${bad ? "bg-bad-soft text-bad" : warn ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"}`}>{bad ? t.health.reauth : warn ? t.health.expires : t.health.ok}</span>
                    {ch.lastError && <p className="mt-1 max-w-xs truncate text-xs text-ink-3">{ch.lastError}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section className="card overflow-x-auto">
        <h2 className="border-b border-line px-6 py-4 text-lg font-bold">{t.health.dead}</h2>
        {deadRows.length === 0 ? (
          <div className="p-6">
            <Notice tone="ok">{t.health.noDead}</Notice>
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line bg-surface-2/60 text-xs uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-6 py-3">{t.health.kind}</th>
                <th className="px-3 py-3">{t.health.error}</th>
                <th className="px-3 py-3">{t.audit.time}</th>
                <th className="px-6 py-3">
                  <span className="sr-only">{t.common.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {deadRows.map(({ j, postId }) => (
                <tr key={j.id}>
                  <td className="px-6 py-3 font-mono text-xs">{j.kind}</td>
                  <td className="max-w-md truncate px-3 py-3 text-xs text-ink-2" title={j.lastError ?? ""}>
                    {j.lastError}
                  </td>
                  <td className="px-3 py-3 text-xs whitespace-nowrap text-ink-3">{df.format(j.updatedAt)}</td>
                  <td className="px-6 py-3 text-right">
                    {j.kind === "publish_target" ? (
                      postId && (
                        <Link href={`/app/posts/${postId}`} className="btn btn-ghost !min-h-[34px] text-xs">
                          {t.health.openPost}
                        </Link>
                      )
                    ) : (
                      <form action={replayJobAction}>
                        <input type="hidden" name="jobId" value={j.id} />
                        <button className="btn btn-ghost !min-h-[34px] text-xs">{t.health.replay}</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
