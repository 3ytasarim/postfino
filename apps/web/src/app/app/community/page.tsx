import Link from "next/link";
import { MessagesSquare, ExternalLink } from "lucide-react";
import { listThreads, getThread, listSavedReplies, communityStats, effectiveCapability } from "@sichttakt/core";
import { PageHeader, Empty, PlatformBadge } from "@/components/ui";
import { CollectNow } from "@/components/collect-now";
import { ReplyBox } from "@/components/reply-box";
import { FormAction } from "@/components/form-action";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext, listVisibleChannels } from "@/lib/server";
import { threadStatusAction, commentToIdeaAction, saveSavedReplyAction, deleteSavedReplyAction } from "../actions-insights";

export const metadata = { title: "Community" };
const FILTERS = ["unanswered", "open", "resolved", "all"] as const;

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ filter?: string; sort?: string; thread?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const filter = (FILTERS as readonly string[]).includes(sp.filter ?? "") ? (sp.filter as (typeof FILTERS)[number]) : "unanswered";
  const sort = sp.sort === "oldest" ? "oldest" : "newest";
  const [threads, saved, stats, channels] = await Promise.all([
    listThreads(ctx.svc.db, ctx.actor, { workspaceId: ctx.workspace.id, filter, sort }),
    listSavedReplies(ctx.svc.db, ctx.actor, ctx.workspace.id),
    communityStats(ctx.svc.db, ctx.actor, { workspaceId: ctx.workspace.id, from: new Date(Date.now() - 30 * 864e5), to: new Date() }),
    listVisibleChannels(ctx, ctx.workspace.id),
  ]);
  const support = await Promise.all(channels.map(async (c) => ({ c, read: await effectiveCapability(ctx.svc.db, c.platform, c.id, "community.comments_read"), reply: await effectiveCapability(ctx.svc.db, c.platform, c.id, "community.comments_reply") })));
  const selected = sp.thread ? await getThread(ctx.svc.db, ctx.actor, sp.thread).catch(() => null) : null;
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "short", timeStyle: "short", timeZone: ctx.workspace.timezone });
  const href = (o: Record<string, string | undefined>) => `/app/community?${new URLSearchParams(Object.entries({ filter, sort, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const ok = (s: string) => s === "supported" || s === "requires_app_review";

  return (
    <>
      <PageHeader title={t.communityPage.title} subtitle={t.communityPage.subtitle} actions={<CollectNow kind="comments" label={t.communityPage.syncNow} done={t.insightsPage.collectQueued} />} />
      <section className="mb-6 grid grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-xs font-semibold text-ink-2">{t.communityPage.received} (30 T.)</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums">{stats.received}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold text-ink-2">{t.communityPage.replyRate}</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums">{stats.replyRate === null ? "–" : `${stats.replyRate} %`}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold text-ink-2">{t.communityPage.median}</p>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums">{stats.medianResponseMinutes === null ? "–" : `${stats.medianResponseMinutes} ${t.communityPage.minutes}`}</p>
        </div>
      </section>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav className="flex rounded-[12px] border border-line bg-surface p-1" aria-label="Filter">
          {FILTERS.map((f) => (
            <Link key={f} href={href({ filter: f, thread: undefined })} aria-current={f === filter ? "page" : undefined} className={`flex min-h-[36px] items-center rounded-[9px] px-3 text-sm font-semibold ${f === filter ? "bg-ink text-bg" : "text-ink-2 hover:bg-surface-2"}`}>
              {t.communityPage[f]}
            </Link>
          ))}
        </nav>
        <Link href={href({ sort: sort === "newest" ? "oldest" : "newest" })} className="btn btn-ghost !min-h-[38px] text-sm">
          {sort === "newest" ? t.communityPage.newest : t.communityPage.oldest}
        </Link>
        <span className="ml-auto flex flex-wrap gap-1">
          {support.map(({ c, read }) => (
            <span key={c.id} className={`chip ${ok(read) ? "bg-surface-2 text-ink-2" : "bg-warn-soft text-warn"}`} title={`community.comments_read: ${read}`}>
              {c.display_name}: {ok(read) ? "✓" : t.communityPage.unsupported}
            </span>
          ))}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr] [&>*]:min-w-0">
        <section className="card overflow-hidden">
          {threads.length === 0 ? (
            <div className="p-6">
              <Empty icon={MessagesSquare} title={t.communityPage.empty} />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {threads.map((th) => (
                <li key={th.id}>
                  <Link href={href({ thread: th.id })} aria-current={sp.thread === th.id ? "true" : undefined} className={`block px-5 py-3 hover:bg-surface-2/50 ${sp.thread === th.id ? "bg-takt-soft/40" : ""}`}>
                    <div className="flex items-center gap-2">
                      <PlatformBadge platform={th.platform} />
                      <span className="truncate text-sm font-semibold">{th.channel}</span>
                      {th.unansweredCount > 0 && <span className="chip ml-auto bg-takt text-takt-ink">{th.unansweredCount}</span>}
                    </div>
                    <p className="mt-1 truncate text-sm text-ink-2">{th.postCaption || "—"}</p>
                    <p className="text-xs text-ink-3">{th.lastCustomerAt ? df.format(th.lastCustomerAt) : ""} · {th.commentCount}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-6">
          {!selected ? (
            <>
              <h2 className="mb-3 font-bold">{t.communityPage.savedReplies}</h2>
              <ul className="mb-4 space-y-2 text-sm">
                {saved.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 rounded-[10px] bg-surface-2 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{s.title}</p>
                      <p className="text-ink-2">{s.body}</p>
                    </div>
                    <form action={deleteSavedReplyAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <button className="btn btn-danger !min-h-[30px] text-xs">{t.common.delete}</button>
                    </form>
                  </li>
                ))}
              </ul>
              <FormAction action={saveSavedReplyAction} submit={t.communityPage.addSaved} className="space-y-2" resetOnSuccess>
                <input name="title" placeholder={t.communityPage.savedTitle} aria-label={t.communityPage.savedTitle} className="input" />
                <textarea name="body" rows={3} maxLength={1000} placeholder={t.communityPage.savedBody} aria-label={t.communityPage.savedBody} className="input" />
              </FormAction>
            </>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 flex-1 truncate font-bold">{selected.thread.postCaption || "—"}</h2>
                {selected.thread.postPermalink && (
                  <a href={selected.thread.postPermalink} target="_blank" rel="noreferrer" className="btn btn-ghost !min-h-[34px] text-xs">
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
                <form action={threadStatusAction}>
                  <input type="hidden" name="threadId" value={selected.thread.id} />
                  <input type="hidden" name="status" value={selected.thread.status === "resolved" ? "open" : "resolved"} />
                  <button className="btn btn-ghost !min-h-[34px] text-xs">{selected.thread.status === "resolved" ? t.communityPage.reopen : t.communityPage.resolve}</button>
                </form>
              </div>
              <ol className="space-y-3">
                {selected.comments.map((c) => (
                  <li key={c.id} className={`rounded-[12px] p-3 ${c.isOwn ? "ml-8 bg-takt-soft/50" : "bg-surface-2"} ${c.parentExternalId && !c.isOwn ? "ml-4" : ""}`}>
                    <p className="text-xs text-ink-3">
                      <strong className="text-ink">{c.authorName ?? "?"}</strong> · {df.format(c.postedAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
                    {!c.isOwn && (
                      <div className="mt-2 space-y-2">
                        <ReplyBox commentId={c.id} commentText={c.body} saved={saved.map((s) => ({ title: s.title, body: s.body }))} aiConfigured={ctx.svc.ai.configured} t={{ reply: t.communityPage.reply, saved: t.communityPage.savedReplies, ai: t.communityPage.aiDraft, label: t.ai.label }} />
                        <form action={commentToIdeaAction}>
                          <input type="hidden" name="commentId" value={c.id} />
                          <button className="text-xs font-semibold text-ink-3 hover:text-takt">{t.communityPage.toIdea}</button>
                        </form>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>
    </>
  );
}
