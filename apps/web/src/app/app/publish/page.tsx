import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Globe, LayoutGrid, List, Plus, SquareStack, Tag, CalendarOff, Inbox } from "lucide-react";
import { listPosts } from "@sichttakt/core";
import { utcToWallClock, wallClockToUtc, isValidTimeZone, type PostStatus } from "@sichttakt/shared";
import { and, eq, schema } from "@sichttakt/db";
import { Empty } from "@/components/ui";
import { StatusChip } from "@/components/status-chip";
import { ChannelAvatar, NetworkIcon } from "@/components/network-icon";
import { FilterMenu } from "@/components/publish/filter-menu";
import { PublishCalendar, type PubCard } from "@/components/publish/publish-calendar";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext, listVisibleChannels } from "@/lib/server";
import { postThumbs } from "@/lib/thumbs";

export const metadata = { title: "Veröffentlichen" };

const GROUPS: { key: "queue" | "drafts" | "approvals" | "sent" | "failed"; statuses: PostStatus[] }[] = [
  { key: "queue", statuses: ["SCHEDULED", "PREPARING_MEDIA", "PUBLISHING", "APPROVED"] },
  { key: "drafts", statuses: ["DRAFT", "CANCELLED"] },
  { key: "approvals", statuses: ["PENDING_APPROVAL", "CHANGES_REQUESTED"] },
  { key: "sent", statuses: ["PUBLISHED", "NOTIFICATION_SENT"] },
  { key: "failed", statuses: ["FAILED_RETRYABLE", "FAILED_FINAL"] },
];
const ZONES = ["Europe/Berlin", "Europe/Vienna", "Europe/Zurich", "Europe/Istanbul", "Europe/London", "UTC", "America/New_York", "America/Los_Angeles", "Asia/Dubai"];
const MOVABLE = ["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "FAILED_RETRYABLE"];

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
function addDays(key: string, n: number) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return keyOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
const weekdayIso = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return ((new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7) + 1;
};

type SP = { view?: string; mode?: string; date?: string; channels?: string; status?: string; tags?: string; nodate?: string; tz?: string; tab?: string; q?: string };

export default async function PublishPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const l = t.publishUi;
  const L = intlLocale(locale);
  const view = sp.view === "list" ? "list" : "calendar";
  const mode = sp.mode === "month" ? "month" : "week";
  const tz = sp.tz && isValidTimeZone(sp.tz) ? sp.tz : ctx.workspace.timezone;
  const statusKey = sp.status ?? sp.tab; // legacy ?tab= links keep working
  const group = GROUPS.find((g) => g.key === statusKey) ?? null;
  const channelFilter = (sp.channels ?? "").split(",").filter(Boolean);
  const tagFilter = (sp.tags ?? "").split(",").filter(Boolean);
  const q = sp.q?.trim().toLowerCase();

  const nowWall = utcToWallClock(new Date(), tz);
  const today = keyOf(nowWall.year, nowWall.month, nowWall.day);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;
  const first = `${anchor.slice(0, 8)}01`;
  // week = 7 days starting at the anchor (today by default) — planning looks forward, not back to Monday
  const start = mode === "month" ? addDays(first, -(weekdayIso(first) - 1)) : anchor;
  const span = mode === "month" ? 42 : 7;
  const days = Array.from({ length: span }, (_, i) => addDays(start, i));
  const toUtc = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return wallClockToUtc({ year: y!, month: m!, day: d!, hour: 0, minute: 0 }, tz);
  };

  const db = ctx.svc.db;
  const [ranged, everything, channels, tagRows] = await Promise.all([
    view === "calendar" ? listPosts(db, ctx.actor, { workspaceId: ctx.workspace.id, from: toUtc(start), to: toUtc(addDays(start, span)), limit: 1000 }) : Promise.resolve([]),
    listPosts(db, ctx.actor, { workspaceId: ctx.workspace.id, limit: 1000 }),
    listVisibleChannels(ctx, ctx.workspace.id),
    db.select({ name: schema.contentTags.name, color: schema.contentTags.color }).from(schema.contentTags).where(and(eq(schema.contentTags.workspaceId, ctx.workspace.id))),
  ]);
  const chan = new Map(channels.map((c) => [c.id, c]));
  const visibleIds = new Set(channels.map((c) => c.id));
  type P = (typeof everything)[number];
  const passes = (p: P) =>
    p.targets.some((x) => visibleIds.has(x.account_id)) || p.targets.length === 0
      ? (!group || group.statuses.includes(p.status)) &&
        (!channelFilter.length || p.targets.some((x) => channelFilter.includes(x.account_id))) &&
        (!tagFilter.length || p.tags.some((tg) => tagFilter.includes(tg))) &&
        (!q || p.caption.toLowerCase().includes(q))
      : false;

  const source = view === "calendar" ? ranged : everything;
  const rows = source.filter(passes);
  const undated = everything.filter((p) => !p.scheduled_at && passes(p));
  const thumbs = await postThumbs(db, ctx.organization.id, rows.slice(0, 400).map((p) => p.id));
  const timeFmt = new Intl.DateTimeFormat(L, { hour: "2-digit", minute: "2-digit", timeZone: tz });

  const cards: PubCard[] = rows
    .filter((p) => p.scheduled_at)
    .flatMap((p) => {
      const at = new Date(p.scheduled_at!);
      const w = utcToWallClock(at, tz);
      const th = thumbs.get(p.id);
      const targets = p.targets.filter((x) => (channelFilter.length ? channelFilter.includes(x.account_id) : visibleIds.has(x.account_id)));
      return (targets.length ? targets : [null]).map((x) => ({
        key: `${p.id}-${x?.id ?? "none"}`,
        postId: p.id,
        day: keyOf(w.year, w.month, w.day),
        hour: w.hour,
        minute: w.minute,
        time: timeFmt.format(at),
        caption: p.caption,
        platform: x ? (chan.get(x.account_id)?.platform ?? null) : null,
        type: p.type,
        status: p.status,
        statusLabel: t.status[p.status],
        thumb: th ? { assetId: th.assetId, kind: th.kind } : null,
        movable: MOVABLE.includes(p.status),
      }));
    });

  // ── URLs ──
  const href = (patch: Partial<Record<keyof SP, string | null>>) => {
    const u = new URLSearchParams();
    const merged: Record<string, string | undefined | null> = { view: sp.view, mode: sp.mode, date: sp.date, channels: sp.channels, status: statusKey, tags: sp.tags, nodate: sp.nodate, tz: sp.tz, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    const s = u.toString();
    return `/app/publish${s ? `?${s}` : ""}`;
  };
  const prev = mode === "month" ? `${addDays(first, -1).slice(0, 8)}01` : addDays(anchor, -7);
  const next = mode === "month" ? `${addDays(first, 32).slice(0, 8)}01` : addDays(anchor, 7);
  const title = new Intl.DateTimeFormat(L, { month: "long", year: "numeric", timeZone: "UTC" }).format(toUtcDate(mode === "month" ? anchor : addDays(start, 3)));

  return (
    <div className="space-y-4">
      {/* header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-[14px] bg-surface ring-1 ring-line">
            <CalendarDays className="size-5" />
          </span>
          <h1 className="font-display text-[1.6rem] font-bold tracking-tight">{t.publish.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <nav className="flex rounded-[12px] bg-surface p-1 ring-1 ring-line" aria-label={l.viewLabel}>
            {(
              [
                ["list", List, l.list],
                ["calendar", CalendarDays, l.calendar],
              ] as const
            ).map(([v, Icon, label]) => (
              <Link key={v} href={href({ view: v === "calendar" ? null : v })} aria-current={view === v ? "page" : undefined} className={`flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-sm font-medium transition-colors ${view === v ? "bg-takt-soft text-takt" : "text-ink-2 hover:text-ink"}`}>
                <Icon className="size-4" /> {label}
              </Link>
            ))}
          </nav>
          <Link href="/app/compose/post" className="btn btn-primary !min-h-[40px] text-sm">
            <Plus className="size-4" /> {l.newPost}
          </Link>
        </div>
      </header>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {view === "calendar" && (
          <>
            <div className="flex items-center">
              <Link href={href({ date: prev })} className="grid size-9 place-items-center rounded-[10px] text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="‹">
                <ChevronLeft className="size-4" />
              </Link>
              <Link href={href({ date: next })} className="grid size-9 place-items-center rounded-[10px] text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label="›">
                <ChevronRight className="size-4" />
              </Link>
            </div>
            <p className="min-w-[150px] font-display text-lg font-bold capitalize">{title}</p>
            <Link href={href({ date: null })} className="flex h-9 items-center rounded-[10px] px-3 text-sm font-medium ring-1 ring-line hover:bg-surface-2">
              {l.today}
            </Link>
            <FilterMenu
              param="mode"
              label={mode === "month" ? l.month : l.week}
              icon={<LayoutGrid className="size-3.5" />}
              options={[
                { value: "week", label: l.week },
                { value: "month", label: l.month },
              ]}
            />
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <FilterMenu
            param="channels"
            multi
            searchable
            label={l.channels}
            allLabel={l.allChannels}
            icon={<SquareStack className="size-3.5" />}
            options={channels.map((c) => ({ value: c.id, label: c.display_name, icon: <ChannelAvatar name={c.display_name} avatarUrl={c.avatar_url} platform={c.platform} size={20} /> }))}
          />
          <FilterMenu
            param="status"
            label={l.allPosts}
            allLabel={l.allPosts}
            icon={<Inbox className="size-3.5" />}
            options={GROUPS.map((g) => ({ value: g.key, label: t.publish[g.key], hint: String(everything.filter((p) => g.statuses.includes(p.status)).length) }))}
          />
          <FilterMenu param="tags" multi searchable label={l.tags} allLabel={l.allTags} icon={<Tag className="size-3.5" />} options={tagRows.map((tg) => ({ value: tg.name, label: tg.name, icon: <span className="size-2.5 rounded-full" style={{ background: tg.color }} /> }))} />
          {view === "calendar" && (
            <Link href={href({ nodate: sp.nodate ? null : "1" })} aria-pressed={Boolean(sp.nodate)} className={`flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[0.82rem] font-medium ${sp.nodate ? "bg-takt-soft text-takt" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}>
              <CalendarOff className="size-3.5" /> {l.noDate}
              {undated.length > 0 && <span className="rounded-full bg-surface-2 px-1.5 text-[0.65rem] tabular-nums text-ink-2">{undated.length}</span>}
            </Link>
          )}
          <FilterMenu param="tz" label={tz.split("/").pop()!.replace(/_/g, " ")} icon={<Globe className="size-3.5" />} align="right" options={[...new Set([ctx.workspace.timezone, ...ZONES])].map((z) => ({ value: z, label: z.replace(/_/g, " "), hint: z === ctx.workspace.timezone ? "★" : undefined }))} />
        </div>
      </div>

      {view === "calendar" ? (
        <PublishCalendar
          key={`${mode}-${start}-${sp.nodate ?? ""}`}
          mode={mode}
          days={days}
          today={today}
          nowHour={nowWall.hour}
          month={anchor.slice(0, 7)}
          timezone={tz}
          locale={L}
          cards={cards}
          undated={undated.slice(0, 40).map((p) => ({ id: p.id, caption: p.caption, type: p.type, platform: chan.get(p.targets[0]?.account_id ?? "")?.platform ?? null }))}
          showUndated={Boolean(sp.nodate)}
          l={{ today: l.today, noDate: l.noDate, noDateEmpty: l.noDateEmpty, plan: l.plan, dragHint: t.calendar.dragHint, close: t.nav.close }}
        />
      ) : rows.length === 0 ? (
        <Empty icon={Inbox} title={t.common.none} />
      ) : (
        <ListView rows={rows} tz={tz} L={L} chan={chan} thumbs={thumbs} statusLabel={(s) => t.status[s as PostStatus]} noDate={l.noDate} />
      )}
    </div>
  );
}

function toUtcDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/** List view: grouped by day (undated last), one row per post with channels, thumb and status. */
function ListView({
  rows,
  tz,
  L,
  chan,
  thumbs,
  statusLabel,
  noDate,
}: {
  rows: Awaited<ReturnType<typeof listPosts>>;
  tz: string;
  L: string;
  chan: Map<string, { platform: string; display_name: string; avatar_url: string | null }>;
  thumbs: Map<string, { assetId: string; kind: "image" | "video"; count: number }>;
  statusLabel: (s: string) => string;
  noDate: string;
}) {
  const dayFmt = new Intl.DateTimeFormat(L, { weekday: "long", day: "numeric", month: "long", timeZone: tz });
  const timeFmt = new Intl.DateTimeFormat(L, { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const sorted = [...rows].sort((a, b) => (a.scheduled_at ?? "9999").localeCompare(b.scheduled_at ?? "9999"));
  const groups = new Map<string, typeof rows>();
  for (const p of sorted) {
    const k = p.scheduled_at ? dayFmt.format(new Date(p.scheduled_at)) : noDate;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([day, ps]) => (
        <section key={day}>
          <h2 className="mb-2 text-sm font-bold">{day}</h2>
          <ul className="space-y-2">
            {ps.map((p) => {
              const th = thumbs.get(p.id);
              return (
                <li key={p.id}>
                  <Link href={`/app/posts/${p.id}`} className="flex items-center gap-4 rounded-[16px] bg-surface p-3 ring-1 ring-line transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgb(0_0_0/0.3)]">
                    <span className="w-14 shrink-0 text-sm font-bold tabular-nums">{p.scheduled_at ? timeFmt.format(new Date(p.scheduled_at)) : "—"}</span>
                    <span className="flex shrink-0 -space-x-1.5">
                      {p.targets.slice(0, 3).map((x) => {
                        const c = chan.get(x.account_id);
                        return c ? <NetworkIcon key={x.id} platform={c.platform} badge size={22} /> : null;
                      })}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{p.caption || "—"}</span>
                    <StatusChip status={p.status} label={statusLabel(p.status)} />
                    {th && (
                      // eslint-disable-next-line @next/next/no-img-element
                      th.kind === "image" ? <img src={`/app/api/media/${th.assetId}`} alt="" className="size-11 rounded-[10px] object-cover" /> : <video src={`/app/api/media/${th.assetId}#t=0.5`} muted preload="metadata" className="size-11 rounded-[10px] object-cover" aria-hidden />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
