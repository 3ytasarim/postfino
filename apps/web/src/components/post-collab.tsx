import { listNotes, listDecisions, type Actor } from "@sichttakt/core";
import type { Db } from "@sichttakt/db";
import type { Messages } from "@/i18n/de";
import { FormAction } from "./form-action";
import { SecretForm } from "./secret-forms";
import { addNoteAction, createReviewLinkAction } from "@/app/app/actions-content";

/** Notes, @mentions, client review link and approval history for one post (server component). */
export async function PostCollab({ db, actor, postId, status, t, df }: { db: Db; actor: Actor; postId: string; status: string; t: Messages; df: Intl.DateTimeFormat }) {
  const [notes, decisions] = await Promise.all([listNotes(db, actor, { postId }), listDecisions(db, actor, postId)]);
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <section className="card p-6">
        <h2 className="mb-4 text-lg font-bold">{t.notes.title}</h2>
        <ul className="mb-4 space-y-2 text-sm">
          {notes.length === 0 && <li className="text-ink-3">{t.notes.empty}</li>}
          {notes.map(({ n, author }) => (
            <li key={n.id} className={`rounded-[12px] p-3 ${n.visibleToClient ? "bg-puls-soft" : "bg-surface-2"}`}>
              <p className="text-xs font-semibold text-ink-3">
                {author} · {df.format(n.createdAt)}
                {n.visibleToClient && ` · ${t.notes.clientVisible}`}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
        <FormAction action={addNoteAction} submit={t.notes.add} className="space-y-2" resetOnSuccess>
          <input type="hidden" name="postId" value={postId} />
          <textarea name="body" rows={2} placeholder={t.notes.placeholder} aria-label={t.notes.add} className="input" />
          <label className="flex items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" name="visibleToClient" className="size-4 accent-[var(--takt)]" /> {t.notes.clientVisible}
          </label>
        </FormAction>
      </section>
      <section className="card p-6">
        <h2 className="mb-4 text-lg font-bold">{t.review.history}</h2>
        {status === "PENDING_APPROVAL" && (
          <div className="mb-4">
            <SecretForm action={createReviewLinkAction} submit={t.review.createLink} secretNote={t.review.linkCreated} submitClassName="btn btn-ghost">
              <input type="hidden" name="postId" value={postId} />
            </SecretForm>
          </div>
        )}
        <ul className="space-y-2 text-sm">
          {decisions.length === 0 && <li className="text-ink-3">{t.common.none}</li>}
          {decisions.map(({ d, version, userName }) => (
            <li key={d.id} className="rounded-[12px] border border-line p-3">
              <p className="flex flex-wrap items-center gap-2">
                <span className={`chip ${d.decision === "approved" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}>{d.decision === "approved" ? t.post.approve : t.post.requestChanges}</span>
                <span className="font-semibold">{userName ?? d.reviewerName ?? "API"}</span>
                <span className="text-xs text-ink-3">
                  v{version} · {t.review.via} {d.via} · {df.format(d.createdAt)}
                </span>
              </p>
              {d.comment && <p className="mt-2 whitespace-pre-wrap text-ink-2">{d.comment}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
