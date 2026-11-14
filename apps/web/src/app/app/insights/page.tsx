import Link from "next/link";
import { LineChart } from "lucide-react";
import { getInsightsOverview, computeTakeaways, METRICS, type MetricValue } from "@sichttakt/core";
import { utcToWallClock } from "@sichttakt/shared";
import { PageHeader, Empty, PlatformBadge } from "@/components/ui";
import { BarChart } from "@/components/bar-chart";
import { CollectNow } from "@/components/collect-now";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext } from "@/lib/server";

export const metadata = { title: "Insights" };
const KPIS = ["reach", "views", "likes", "comments", "saves", "shares", "engagement_rate"] as const;

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ days?: string; channel?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 864e5);
  const ov = await getInsightsOverview(ctx.svc.db, ctx.actor, { workspaceId: ctx.workspace.id, from, to, channelIds: sp.channel ? [sp.channel] : undefined });
  const takeaways = computeTakeaways(ov.posts, ctx.workspace.timezone, { from, to });
  const nf = new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 });
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: ctx.workspace.timezone });
  const lab = (k: string) => METRICS[k as keyof typeof METRICS]?.[locale] ?? k;
  const fmt = (m: MetricValue | undefined, pct = false) =>
    !m || m.status === "not_collected" ? (
      <span className="text-ink-3" title={t.insightsPage.notCollected}>–</span>
    ) : m.status === "not_available" ? (
      <span className="chip bg-surface-2 text-ink-3" title={t.insightsPage.notAvailableHint}>{t.insightsPage.notAvailable}</span>
    ) : (
      <>{nf.format(m.value!)}{pct ? " %" : ""}</>
    );

  // Daily interactions (likes + comments + saves + shares) by local publishing day.
  const byDay = new Map<string, number>();
  let anyInter = false;
  for (const p of ov.posts) {
    const parts = ["likes", "comments", "saves", "shares"].map((k) => p.metrics[k]).filter((m) => m?.status === "ok");
    if (!parts.length) continue;
    anyInter = true;
    const w = utcToWallClock(p.publishedAt, ctx.workspace.timezone);
    const key = `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
    byDay.set(key, (byDay.get(key) ?? 0) + parts.reduce((s, m) => s + (m!.value ?? 0), 0));
  }
  const series = anyInter ? [...byDay.entries()].sort().map(([day, value]) => ({ day, value })) : [];
  const q = (o: Record<string, string | undefined>) => `/app/insights?${new URLSearchParams(Object.entries({ days: String(days), channel: sp.channel, ...o }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <PageHeader title={t.insightsPage.title} subtitle={t.insightsPage.subtitle} actions={<CollectNow label={t.insightsPage.collectNow} done={t.insightsPage.collectQueued} />} />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex rounded-[12px] border border-line bg-surface p-1" role="group" aria-label={t.insightsPage.range}>
          {[7, 30, 90].map((d) => (
            <Link key={d} href={q({ days: String(d) })} aria-current={d === days ? "page" : undefined} className={`flex min-h-[36px] items-center rounded-[9px] px-3 text-sm font-semibold ${d === days ? "bg-ink text-bg" : "text-ink-2 hover:bg-surface-2"}`}>
              {t.insightsPage[`days${d}` as "days7"]}
            </Link>
          ))}
        </div>
        <Link href={q({ channel: undefined })} className={`chip ${!sp.channel ? "bg-ink text-bg" : "bg-surface-2 text-ink-2"}`}>
          {t.calendar.allChannels}
        </Link>
        {ov.accounts.map((a) => (
          <Link key={a.channelId} href={q({ channel: a.channelId })} className={`chip ${sp.channel === a.channelId ? "bg-ink text-bg" : "bg-surface-2 text-ink-2"}`}>
            {a.name}
          </Link>
        ))}
        <span className="ml-auto text-xs text-ink-3">
          {df.format(from)} – {df.format(to)} · {t.insightsPage.sample}: {ov.sampleSize}
        </span>
      </div>

      {ov.accounts.length === 0 ? (
        <Empty icon={LineChart} title={t.composer.noChannels} />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" aria-label="KPIs">
            {KPIS.map((k) => {
              const s = ov.summary[k]!;
              return (
                <div key={k} className="card p-4" title={METRICS[k].desc[locale]}>
                  <p className="text-xs font-semibold text-ink-2">{lab(k)}</p>
                  <p className="mt-2 font-display text-2xl font-bold tabular-nums">{fmt(s.current, k === "engagement_rate")}</p>
                  {s.deltaPct !== null && (
                    <p className={`mt-1 text-xs font-semibold ${s.deltaPct >= 0 ? "text-ok" : "text-bad"}`}>
                      {s.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(s.deltaPct)} % <span className="font-normal text-ink-3">{t.insightsPage.vsPrev}</span>
                    </p>
                  )}
                </div>
              );
            })}
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
            <section className="card p-6">
              <h2 className="mb-3 text-lg font-bold">{t.insightsPage.chartTitle}</h2>
              <BarChart data={series} label={t.insightsPage.chartTitle} locale={intlLocale(locale)} emptyText={t.insightsPage.chartEmpty} />
            </section>
            <section className="card p-6">
              <h2 className="mb-3 text-lg font-bold">{t.insightsPage.takeaways}</h2>
              <ul className="space-y-2 text-sm">
                {takeaways.map((x, i) => (
                  <li key={i} className={`rounded-[12px] p-3 ${x.kind === "insufficient_data" ? "bg-surface-2 text-ink-2" : "bg-takt-soft/50"}`}>
                    {x.text[locale]}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-3">
                {t.insightsPage.sample}: {takeaways[0]?.evidence.sample ?? 0} · {takeaways[0]?.evidence.from} – {takeaways[0]?.evidence.to}
              </p>
            </section>
          </div>

          <section className="card mt-6 overflow-x-auto">
            <h2 className="border-b border-line px-6 py-4 text-lg font-bold">{t.insightsPage.accounts}</h2>
            <table className="w-full min-w-[620px] text-left text-sm">
              <tbody className="divide-y divide-line">
                {ov.accounts.map((a) => (
                  <tr key={a.channelId}>
                    <td className="px-6 py-3 font-semibold">{a.name}</td>
                    <td className="px-3 py-3">
                      <PlatformBadge platform={a.platform} sandbox={a.sandbox} />
                    </td>
                    <td className="px-3 py-3">
                      {t.insightsPage.followers}: <strong className="tabular-nums">{fmt(a.followers)}</strong>
                      {a.followerGrowth !== null && <span className={`ml-2 text-xs ${a.followerGrowth >= 0 ? "text-ok" : "text-bad"}`}>{a.followerGrowth >= 0 ? "+" : ""}{nf.format(a.followerGrowth)}</span>}
                    </td>
                    <td className="px-3 py-3 text-ink-2">
                      {t.insightsPage.posts}: {a.posts}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-ink-3">
                      {t.insightsPage.capability}: {a.insightsCapability}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card mt-6 overflow-x-auto">
            <h2 className="border-b border-line px-6 py-4 text-lg font-bold">{t.insightsPage.posts}</h2>
            {ov.posts.length === 0 ? (
              <p className="px-6 py-6 text-sm text-ink-3">{t.common.none}</p>
            ) : (
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-line bg-surface-2/60 text-xs uppercase tracking-wider text-ink-3">
                  <tr>
                    <th className="px-6 py-3">{t.composer.when}</th>
                    <th className="px-3 py-3">{t.composer.caption}</th>
                    {KPIS.map((k) => (
                      <th key={k} className="px-3 py-3 text-right">{lab(k)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ov.posts.map((p) => (
                    <tr key={p.publishedPostId}>
                      <td className="px-6 py-2.5 whitespace-nowrap text-ink-2">{df.format(p.publishedAt)}</td>
                      <td className="max-w-[260px] truncate px-3 py-2.5">
                        <Link href={`/app/posts/${p.postId}`} className="hover:text-takt">
                          <span className="mr-1 chip bg-surface-2 text-ink-3 uppercase">{p.type}</span>
                          {p.caption || "—"}
                        </Link>
                      </td>
                      {KPIS.map((k) => (
                        <td key={k} className="px-3 py-2.5 text-right tabular-nums">
                          {fmt(p.metrics[k], k === "engagement_rate")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <details className="mt-6 rounded-[14px] border border-line bg-surface p-5 text-sm">
            <summary className="cursor-pointer font-semibold">{t.insightsPage.definitions}</summary>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {Object.entries(METRICS).map(([k, m]) => (
                <div key={k}>
                  <dt className="font-semibold">{m[locale]}</dt>
                  <dd className="text-ink-2">{m.desc[locale]}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      )}
    </>
  );
}
