import Link from "next/link";
import { ArrowLeft, Shuffle } from "lucide-react";
import { and, asc, eq, gt, schema } from "@sichttakt/db";
import { getChannel, listSlots } from "@sichttakt/core";
import { utcToWallClock } from "@sichttakt/shared";
import { PageHeader, Notice } from "@/components/ui";
import { SlotEditor } from "@/components/slot-editor";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext } from "@/lib/server";
import { shuffleQueueAction, toggleQueuePauseAction } from "../../../actions";

export default async function ChannelQueuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const ch = await getChannel(ctx.svc.db, ctx.actor, id);
  const slots = await listSlots(ctx.svc.db, ctx.actor, id);
  const upcoming = await ctx.svc.db
    .select({ t: schema.postTargets, caption: schema.posts.caption })
    .from(schema.postTargets)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.postTargets.postId))
    .where(and(eq(schema.postTargets.channelId, id), eq(schema.postTargets.status, "SCHEDULED"), gt(schema.postTargets.scheduledAt, new Date())))
    .orderBy(asc(schema.postTargets.scheduledAt))
    .limit(30);
  const [ws] = await ctx.svc.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, ch.workspaceId));
  const df = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: ch.timezone });

  return (
    <>
      <Link href="/app/channels" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> {t.channels.title}
      </Link>
      <PageHeader eyebrow={`${ch.displayName} · ${ch.timezone}`} title={t.queue.title} subtitle={t.queue.subtitle} />
      {ws!.queuePaused && (
        <div className="mb-6">
          <Notice tone="warn">{t.queue.paused}</Notice>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <section className="card p-6">
          <h2 className="mb-4 text-lg font-bold">{t.queue.slots}</h2>
          <SlotEditor channelId={id} initial={slots} weekdays={t.queue.weekdays.split(",")} t={{ add: t.queue.addSlot, save: t.common.save, remove: t.compose.remove }} />
        </section>
        <section className="card p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{t.queue.plan}</h2>
            <div className="flex gap-2">
              <form action={shuffleQueueAction}>
                <input type="hidden" name="channelId" value={id} />
                <button className="btn btn-ghost !min-h-[38px] text-sm" disabled={upcoming.length < 2}>
                  <Shuffle className="size-4" /> {t.queue.shuffle}
                </button>
              </form>
              <form action={toggleQueuePauseAction}>
                <input type="hidden" name="paused" value={String(!ws!.queuePaused)} />
                <button className="btn btn-ghost !min-h-[38px] text-sm">{ws!.queuePaused ? t.queue.resume : t.queue.pause}</button>
              </form>
            </div>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-ink-3">{t.common.none}</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {upcoming.map((u) => {
                const w = utcToWallClock(u.t.scheduledAt!, ch.timezone);
                const onSlot = slots.some((s) => s.minuteOfDay === w.hour * 60 + w.minute);
                return (
                  <li key={u.t.id} className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2">
                    <span className="w-36 shrink-0 font-semibold tabular-nums">{df.format(u.t.scheduledAt!)}</span>
                    <Link href={`/app/posts/${u.t.postId}`} className="min-w-0 flex-1 truncate text-ink-2 hover:text-takt">
                      {u.caption || "—"}
                    </Link>
                    {onSlot && <span className="chip bg-takt-soft text-takt">Slot</span>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
