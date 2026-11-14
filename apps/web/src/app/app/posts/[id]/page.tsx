import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { desc, eq, inArray, schema } from "@sichttakt/db";
import { getPost, listChannels, can } from "@sichttakt/core";
import { PageHeader, Notice, PlatformBadge } from "@/components/ui";
import { StatusChip } from "@/components/status-chip";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext } from "@/lib/server";
import { approvePostAction, requestChangesAction, submitApprovalAction, publishNowAction, cancelPostAction, clonePostAction, queuePostAction } from "../../actions";
import { RescheduleForm } from "@/components/reschedule-form";
import { FormAction } from "@/components/form-action";
import { markPublishedAction } from "../../actions-billing";
import { PostCollab } from "@/components/post-collab";
import { utcToWallClock } from "@sichttakt/shared";

export default async function PostDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const { post, targets, media } = await getPost(ctx.svc.db, ctx.actor, id);
  const channels = await listChannels(ctx.svc.db, ctx.actor, post.workspaceId);
  const ch = new Map(channels.map((c) => [c.id, c]));
  const attempts = targets.length
    ? await ctx.svc.db.select().from(schema.publishAttempts).where(inArray(schema.publishAttempts.postTargetId, targets.map((x) => x.id))).orderBy(desc(schema.publishAttempts.createdAt)).limit(50)
    : [];
  const assets = media.length ? await ctx.svc.db.select().from(schema.mediaAssets).where(inArray(schema.mediaAssets.id, media.map((m) => m.assetId))) : [];
  const [ws] = await ctx.svc.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, post.workspaceId));
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "medium", timeZone: ws!.timezone });
  const role = ctx.actor.kind === "user" ? (ctx.actor.workspaceRoles[post.workspaceId] ?? ctx.actor.orgRole) : null;
  const allowed = (p: Parameters<typeof can>[1]) => ctx.actor.kind === "user" && (ctx.actor.isSuperAdmin || (role ? can(role, p) : false));
  const hidden = <input type="hidden" name="postId" value={post.id} />;

  return (
    <>
      <Link href="/app/publish" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> {t.publish.title}
      </Link>
      <PageHeader eyebrow={`${t.post.detail} · ${post.type.toUpperCase()}`} title={post.caption.slice(0, 80) || "—"} actions={<StatusChip status={post.status} label={t.status[post.status]} />} />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <section className="card space-y-5 p-6">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="label">{t.composer.when}</dt>
              <dd className="font-semibold tabular-nums">{post.scheduledAt ? fmt.format(post.scheduledAt) : "—"} <span className="text-ink-3">({ws!.timezone})</span></dd>
            </div>
            <div>
              <dt className="label">{t.post.version}</dt>
              <dd className="font-semibold">
                v{post.currentVersion} · {t.post.approvedVersion}: {post.approvedVersion ? `v${post.approvedVersion}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="label">{t.composer.coverMode}</dt>
              <dd className="font-semibold">{post.coverMode === "independent_image" ? t.composer.coverIndependent : post.coverMode === "video_frame" ? t.composer.coverFrame : "—"}</dd>
            </div>
            <div>
              <dt className="label">Medien</dt>
              <dd className="space-y-0.5 text-ink-2">
                {media.map((m) => {
                  const a = assets.find((x) => x.id === m.assetId);
                  return (
                    <p key={`${m.assetId}-${m.role}`} className="truncate">
                      <span className="font-semibold text-ink">{m.role}</span> · {a?.originalFilename} {a?.width ? `· ${a.width}×${a.height}` : ""}
                    </p>
                  );
                })}
              </dd>
            </div>
          </dl>
          <div>
            <p className="label">{t.composer.caption}</p>
            <p className="whitespace-pre-wrap rounded-[12px] bg-surface-2 p-4 text-sm">{post.caption || "—"}</p>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line pt-5">
            {post.status === "PENDING_APPROVAL" && allowed("posts.approve") && (
              <>
                <form action={approvePostAction}>
                  {hidden}
                  <button className="btn btn-primary">{t.post.approve}</button>
                </form>
                <form action={requestChangesAction}>
                  {hidden}
                  <button className="btn btn-ghost">{t.post.requestChanges}</button>
                </form>
              </>
            )}
            {["DRAFT", "CHANGES_REQUESTED", "APPROVED"].includes(post.status) && ws!.approvalRequired && post.status !== "APPROVED" && (
              <form action={submitApprovalAction}>
                {hidden}
                <button className="btn btn-ghost">{t.post.submitApproval}</button>
              </form>
            )}
            {["DRAFT", "APPROVED", "FAILED_FINAL", "FAILED_RETRYABLE"].includes(post.status) && allowed("posts.publish") && (!ws!.approvalRequired || post.approvedVersion === post.currentVersion) && (
              <form action={publishNowAction}>
                {hidden}
                <button className="btn btn-primary">{t.post.publishNow}</button>
              </form>
            )}
            {!["PUBLISHED", "PUBLISHING", "CANCELLED", "NOTIFICATION_SENT", "FAILED_FINAL", "PREPARING_MEDIA"].includes(post.status) && (
              <form action={cancelPostAction}>
                {hidden}
                <button className="btn btn-danger">{t.post.cancel}</button>
              </form>
            )}
            <form action={clonePostAction}>
              {hidden}
              <button className="btn btn-ghost">{t.postActions.clone}</button>
            </form>
          </div>
          {["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "FAILED_RETRYABLE"].includes(post.status) && (
            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-5">
              <RescheduleForm postId={post.id} defaultWhen={post.scheduledAt ? wallInput(post.scheduledAt, ws!.timezone) : ""} label={t.postActions.reschedule} dstGap={t.composer.dstGap} />
              <form action={queuePostAction}>
                {hidden}
                <button className="btn btn-ghost">{t.postActions.queue}</button>
              </form>
            </div>
          )}
        </section>

        <section className="card p-6">
          <h2 className="mb-4 text-lg font-bold">{t.post.targets}</h2>
          <ul className="space-y-3">
            {targets.map((x) => (
              <li key={x.id} className="rounded-[14px] border border-line p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{ch.get(x.channelId)?.display_name ?? x.channelId}</span>
                  <StatusChip status={x.status} label={t.status[x.status]} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <PlatformBadge platform={ch.get(x.channelId)?.platform ?? "?"} sandbox={ch.get(x.channelId)?.is_sandbox} />
                  <span>{x.publishMode === "notification" ? t.composer.notification : t.composer.automatic}</span>
                  <span>· Versuche: {x.attempts}</span>
                </div>
                {x.errorCode && (
                  <div className="mt-3">
                    <Notice tone="bad">
                      <span className="font-mono">{x.errorCode}</span> — {x.errorMessage}
                    </Notice>
                  </div>
                )}
                {x.status === "NOTIFICATION_SENT" && allowed("posts.publish") && (
                  <details className="mt-3 rounded-[12px] border border-line p-3" open>
                    <summary className="cursor-pointer text-sm font-semibold">{t.manual.title}</summary>
                    <p className="mt-2 text-xs text-ink-3">{t.manual.hint}</p>
                    <FormAction action={markPublishedAction} submit={t.manual.confirm} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end" submitClassName="btn btn-primary !min-h-[40px]">
                      <input type="hidden" name="targetId" value={x.id} />
                      <input type="hidden" name="postId" value={post.id} />
                      <input name="permalink" type="url" placeholder="https://" aria-label={t.manual.permalink} className="input flex-1" />
                    </FormAction>
                  </details>
                )}
                {x.permalink && (
                  <a href={x.permalink} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-takt">
                    {t.post.permalink} <ExternalLink className="size-3.5" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card mt-6 overflow-hidden">
        <h2 className="border-b border-line px-6 py-4 text-lg font-bold">{t.post.attempts}</h2>
        {attempts.length === 0 ? (
          <p className="px-6 py-6 text-sm text-ink-3">{t.common.none}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-line">
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td className="px-6 py-2.5 whitespace-nowrap text-ink-3 tabular-nums">{fmt.format(a.createdAt)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">#{a.attempt} {a.step}</td>
                  <td className="px-3 py-2.5">
                    <span className={`chip ${a.outcome === "ok" ? "bg-ok-soft text-ok" : a.outcome === "blocked" ? "bg-puls-soft text-puls" : "bg-bad-soft text-bad"}`}>{a.outcome}</span>
                  </td>
                  <td className="px-6 py-2.5 font-mono text-xs text-ink-3">{a.errorCode ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <PostCollab db={ctx.svc.db} actor={ctx.actor} postId={post.id} status={post.status} t={t} df={fmt} />
    </>
  );
}

function wallInput(d: Date, tz: string) {
  const w = utcToWallClock(d, tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${p(w.month)}-${p(w.day)}T${p(w.hour)}:${p(w.minute)}`;
}
