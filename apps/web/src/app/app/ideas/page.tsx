import Link from "next/link";
import { Lightbulb, Rss, X } from "lucide-react";
import { listBoards, listIdeas, listTemplates, listFeeds, listNotes, getIdea } from "@sichttakt/core";
import { PageHeader, Empty } from "@/components/ui";
import { IdeaBoard } from "@/components/idea-board";
import { FormAction } from "@/components/form-action";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext, listVisibleChannels } from "@/lib/server";
import { createIdeaAction, updateIdeaAction, deleteIdeaAction, ideaToPostAction, saveTemplateAction, deleteTemplateAction, addFeedAction, removeFeedAction, addNoteAction } from "../actions-content";

export const metadata = { title: "Ideen" };
const TABS = ["board", "gallery", "templates", "rss"] as const;

export default async function IdeasPage({ searchParams }: { searchParams: Promise<{ tab?: string; idea?: string; tag?: string; q?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "board";
  const [boards, ideas, templates, feeds, channels] = await Promise.all([
    listBoards(ctx.svc.db, ctx.actor, ctx.workspace.id),
    listIdeas(ctx.svc.db, ctx.actor, ctx.workspace.id, { tag: sp.tag, q: sp.q }),
    listTemplates(ctx.svc.db, ctx.actor, ctx.workspace.id),
    listFeeds(ctx.svc.db, ctx.actor, ctx.workspace.id),
    listVisibleChannels(ctx, ctx.workspace.id),
  ]);
  const board = boards[0]!;
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
  const selected = sp.idea ? await getIdea(ctx.svc.db, ctx.actor, sp.idea).catch(() => null) : null;
  const notes = selected ? await listNotes(ctx.svc.db, ctx.actor, { ideaId: selected.id }) : [];
  const allTags = [...new Set(ideas.flatMap((i) => i.tags))].sort();
  const href = (q: Record<string, string | undefined>) => `/app/ideas?${new URLSearchParams(Object.entries({ tab, ...q }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <PageHeader title={t.ideasPage.title} subtitle={t.ideasPage.subtitle} />
      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-[14px] border border-line bg-surface p-1" aria-label="Ansicht">
        {TABS.map((k) => (
          <Link key={k} href={`/app/ideas?tab=${k}`} aria-current={k === tab ? "page" : undefined} className={`flex min-h-[40px] items-center rounded-[10px] px-4 text-sm font-semibold whitespace-nowrap ${k === tab ? "bg-ink text-bg" : "text-ink-2 hover:bg-surface-2"}`}>
            {t.ideasPage[k]}
            {k === "board" || k === "gallery" ? <span className="ml-2 rounded-full bg-surface-2/40 px-1.5 text-xs">{ideas.length}</span> : null}
          </Link>
        ))}
      </nav>

      {(tab === "board" || tab === "gallery") && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <form action="/app/ideas" className="flex gap-2">
              <input type="hidden" name="tab" value={tab} />
              <input name="q" defaultValue={sp.q} placeholder={t.common.search} className="input !min-h-[38px] !w-56" aria-label={t.common.search} />
            </form>
            {allTags.map((tg) => (
              <Link key={tg} href={href({ tag: sp.tag === tg ? undefined : tg })} className={`chip ${sp.tag === tg ? "bg-ink text-bg" : "bg-surface-2 text-ink-2"}`}>
                #{tg}
              </Link>
            ))}
          </div>
          <details className="mb-6 rounded-[14px] border border-line bg-surface p-4">
            <summary className="cursor-pointer font-semibold">+ {t.ideasPage.newIdea}</summary>
            <FormAction action={createIdeaAction} submit={t.common.create} className="mt-4 grid gap-3 sm:grid-cols-2" resetOnSuccess>
              <input name="title" required placeholder={t.ideasPage.titleField} aria-label={t.ideasPage.titleField} className="input sm:col-span-2" />
              <textarea name="body" rows={3} placeholder={t.ideasPage.body} aria-label={t.ideasPage.body} className="input sm:col-span-2" />
              <textarea name="links" rows={2} placeholder={t.ideasPage.links} aria-label={t.ideasPage.links} className="input" />
              <input name="tags" placeholder={t.ideasPage.tags} aria-label={t.ideasPage.tags} className="input" />
            </FormAction>
          </details>
          {ideas.length === 0 ? (
            <Empty icon={Lightbulb} title={t.ideasPage.empty} />
          ) : tab === "board" ? (
            <IdeaBoard columns={board.columns} ideas={ideas.map((i) => ({ id: i.id, title: i.title, body: i.body, columnId: i.columnId ?? board.columns[0]!.id, tags: i.tags, source: i.source }))} />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ideas.map((i) => (
                <li key={i.id}>
                  <Link href={href({ idea: i.id })} className="card block h-full p-5 transition hover:shadow-lg">
                    <p className="font-display text-lg font-bold">{i.title}</p>
                    <p className="mt-2 line-clamp-4 text-sm text-ink-2">{i.body || "—"}</p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {i.source !== "manual" && <span className="chip bg-puls-soft text-puls">{i.source}</span>}
                      {i.tags.map((tg) => (
                        <span key={tg} className="chip bg-surface-2 text-ink-3">#{tg}</span>
                      ))}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "templates" && (
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
          <section className="card p-6">
            {templates.length === 0 ? (
              <p className="text-sm text-ink-3">{t.common.none}</p>
            ) : (
              <ul className="divide-y divide-line">
                {templates.map((tp) => (
                  <li key={tp.id} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {tp.name} <span className="chip ml-1 bg-surface-2 text-ink-3">{tp.kind}</span>
                      </p>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-ink-2">{tp.body}</p>
                    </div>
                    <form action={deleteTemplateAction}>
                      <input type="hidden" name="id" value={tp.id} />
                      <button className="btn btn-danger !min-h-[34px] text-xs">{t.common.delete}</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card h-fit p-6">
            <FormAction action={saveTemplateAction} submit={t.ideasPage.saveTemplate} className="space-y-3" resetOnSuccess>
              <input name="name" required placeholder={t.ideasPage.templateName} aria-label={t.ideasPage.templateName} className="input" />
              <select name="kind" className="input" aria-label={t.ideasPage.templateKind}>
                <option value="caption">Caption</option>
                <option value="hashtags">Hashtags</option>
                <option value="first_comment">{t.compose.firstComment}</option>
              </select>
              <textarea name="body" rows={6} required placeholder={t.ideasPage.templateBody} aria-label={t.ideasPage.templateBody} className="input" />
            </FormAction>
          </section>
        </div>
      )}

      {tab === "rss" && (
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
          <section className="card p-6">
            {feeds.length === 0 ? (
              <Empty icon={Rss} title={t.common.none} />
            ) : (
              <ul className="divide-y divide-line">
                {feeds.map((f) => (
                  <li key={f.id} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{f.title ?? f.url}</p>
                      <p className="truncate text-xs text-ink-3">{f.url}</p>
                      <p className="text-xs text-ink-3">
                        {t.ideasPage.lastFetch}: {f.lastFetchedAt ? df.format(f.lastFetchedAt) : "—"}
                        {f.lastError && <span className="ml-2 text-bad">{f.lastError}</span>}
                      </p>
                    </div>
                    <form action={removeFeedAction}>
                      <input type="hidden" name="feedId" value={f.id} />
                      <button className="btn btn-danger !min-h-[34px] text-xs">{t.common.delete}</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card h-fit p-6">
            <FormAction action={addFeedAction} submit={t.ideasPage.addFeed} className="space-y-3" resetOnSuccess>
              <input name="url" type="url" required placeholder="https://blog.example.de/feed.xml" aria-label={t.ideasPage.feedUrl} className="input" />
            </FormAction>
          </section>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={selected.title}>
          <Link href={href({})} className="absolute inset-0 bg-black/40" aria-label={t.common.cancel} />
          <aside className="relative h-full w-full max-w-lg overflow-y-auto bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">{selected.title}</h2>
              <Link href={href({})} className="btn btn-ghost !min-h-[36px] !px-2" aria-label={t.common.cancel}>
                <X className="size-4" />
              </Link>
            </div>
            <FormAction action={updateIdeaAction} submit={t.common.save} className="space-y-3">
              <input type="hidden" name="ideaId" value={selected.id} />
              <input name="title" defaultValue={selected.title} className="input" aria-label={t.ideasPage.titleField} />
              <textarea name="body" rows={5} defaultValue={selected.body} className="input" aria-label={t.ideasPage.body} />
              <textarea name="links" rows={2} defaultValue={selected.links.join("\n")} className="input" aria-label={t.ideasPage.links} />
              <input name="tags" defaultValue={selected.tags.join(", ")} className="input" aria-label={t.ideasPage.tags} />
            </FormAction>
            <section className="mt-6 rounded-[14px] border border-line p-4">
              <h3 className="mb-3 font-bold">{t.ideasPage.toPost}</h3>
              <FormAction action={ideaToPostAction} submit={t.ideasPage.toPost} className="space-y-3">
                <input type="hidden" name="ideaId" value={selected.id} />
                <select name="type" className="input" aria-label={t.ideasPage.format} defaultValue={selected.mediaAssetIds.length ? "image" : "text"}>
                  {["image", "carousel", "text", "video", "reel", "story"].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
                {channels.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="accountIds" value={c.id} defaultChecked={c.is_sandbox} className="size-4 accent-[var(--takt)]" /> {c.display_name}
                  </label>
                ))}
              </FormAction>
            </section>
            <section className="mt-6">
              <h3 className="mb-2 font-bold">{t.notes.title}</h3>
              <ul className="mb-3 space-y-2 text-sm">
                {notes.length === 0 && <li className="text-ink-3">{t.notes.empty}</li>}
                {notes.map((n) => (
                  <li key={n.n.id} className="rounded-[10px] bg-surface-2 p-3">
                    <p className="text-xs font-semibold text-ink-3">
                      {n.author} · {df.format(n.n.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{n.n.body}</p>
                  </li>
                ))}
              </ul>
              <FormAction action={addNoteAction} submit={t.notes.add} className="space-y-2" resetOnSuccess>
                <input type="hidden" name="ideaId" value={selected.id} />
                <textarea name="body" rows={2} placeholder={t.notes.placeholder} aria-label={t.notes.add} className="input" />
              </FormAction>
            </section>
            <form action={deleteIdeaAction} className="mt-6 border-t border-line pt-4">
              <input type="hidden" name="ideaId" value={selected.id} />
              <button className="btn btn-danger">{t.common.delete}</button>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
