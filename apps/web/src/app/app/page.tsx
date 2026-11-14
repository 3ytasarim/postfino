import Link from "next/link";
import { Activity, AlertTriangle, ArrowRight, ArrowUpRight, ArrowDownRight, CalendarCheck, CalendarClock, CalendarDays, Clock3, Inbox, Info, Layers, Lightbulb, Link2, MessageCircle, Minus, PenSquare, Plug, Plus, Send, TrendingUp, UsersRound, Zap } from "lucide-react";
import { and, count, desc, eq, gte, inArray, isNull, isNotNull, schema } from "@sichttakt/db";
import { listPosts } from "@sichttakt/core";
import { Notice } from "@/components/ui";
import { ChannelAvatar, NetworkIcon, NETWORK_NAMES, networkColor } from "@/components/network-icon";
import { PostThumb } from "@/components/post-thumb";
import { Heatmap, type DonutSeg } from "@/components/dash/charts";
import { Bento, CountUp, WaveArt, TopoArt, Capsule } from "@/components/dash/bento";
import { RhythmChart } from "@/components/dash/rhythm-chart";
import { TabPanel } from "@/components/dash/tab-panel";
import { getMessages, intlLocale, fmt as fill } from "@/i18n";
import { requireContext, listVisibleChannels } from "@/lib/server";
import { postThumbs } from "@/lib/thumbs";

export const metadata = { title: "Übersicht" };

const DAY = 864e5;
const RANGES = [7, 30, 90] as const;
const QUEUED = ["SCHEDULED", "APPROVED", "PENDING_APPROVAL"];
const ENGAGEMENT = ["likes", "comments", "shares", "saves"];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams;
  const R = (RANGES as readonly number[]).includes(Number(sp.range)) ? Number(sp.range) : 30;
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const d = t.dash;
  const db = ctx.svc.db;
  const tz = ctx.workspace.timezone;
  const now = new Date();
  const L = intlLocale(locale);

  const [posts, channels] = await Promise.all([listPosts(db, ctx.actor, { workspaceId: ctx.workspace.id, limit: 500 }), listVisibleChannels(ctx, ctx.workspace.id)]);
  const chan = new Map(channels.map((c) => [c.id, c]));
  const channelIds = channels.map((c) => c.id);
  const since = new Date(now.getTime() - Math.max(2 * R, 90) * DAY);

  const [publishedAll, received, followerSnaps, openComments, slots, [{ value: members } = { value: 0 }], [{ value: startPages } = { value: 0 }]] = await Promise.all([
    db
      .select({ id: schema.publishedPosts.id, at: schema.publishedPosts.publishedAt, channelId: schema.publishedPosts.channelId, platform: schema.publishedPosts.platform })
      .from(schema.publishedPosts)
      .where(and(eq(schema.publishedPosts.workspaceId, ctx.workspace.id), gte(schema.publishedPosts.publishedAt, since))),
    channelIds.length
      ? db
          .select({ at: schema.comments.postedAt })
          .from(schema.comments)
          .innerJoin(schema.commentThreads, eq(schema.commentThreads.id, schema.comments.threadId))
          .where(and(inArray(schema.commentThreads.channelId, channelIds), eq(schema.comments.isOwn, false), gte(schema.comments.postedAt, new Date(now.getTime() - 2 * R * DAY))))
      : Promise.resolve([] as { at: Date }[]),
    channelIds.length
      ? db
          .select({ channelId: schema.analyticsSnapshots.channelId, value: schema.analyticsSnapshots.value, at: schema.analyticsSnapshots.collectedAt })
          .from(schema.analyticsSnapshots)
          .where(and(inArray(schema.analyticsSnapshots.channelId, channelIds), eq(schema.analyticsSnapshots.metricKey, "followers"), eq(schema.analyticsSnapshots.available, true)))
          .orderBy(desc(schema.analyticsSnapshots.collectedAt))
      : Promise.resolve([] as { channelId: string; value: number | null; at: Date }[]),
    channelIds.length
      ? db
          .select({ id: schema.comments.id, author: schema.comments.authorName, body: schema.comments.body, at: schema.comments.postedAt, channelId: schema.commentThreads.channelId, threadId: schema.commentThreads.id })
          .from(schema.comments)
          .innerJoin(schema.commentThreads, eq(schema.commentThreads.id, schema.comments.threadId))
          .where(and(inArray(schema.commentThreads.channelId, channelIds), eq(schema.commentThreads.status, "open"), eq(schema.comments.isOwn, false), isNull(schema.comments.repliedAt), isNull(schema.comments.hiddenAt)))
          .orderBy(desc(schema.comments.postedAt))
          .limit(20)
      : Promise.resolve([] as { id: string; author: string | null; body: string; at: Date; channelId: string; threadId: string }[]),
    channelIds.length ? db.select({ channelId: schema.scheduledSlots.channelId }).from(schema.scheduledSlots).where(inArray(schema.scheduledSlots.channelId, channelIds)) : Promise.resolve([] as { channelId: string }[]),
    db.select({ value: count() }).from(schema.memberships).where(and(eq(schema.memberships.organizationId, ctx.organization.id), isNotNull(schema.memberships.userId))),
    db.select({ value: count() }).from(schema.startPages).where(eq(schema.startPages.workspaceId, ctx.workspace.id)),
  ]);

  // only posts of visible (non-sandbox) channels count
  const visible = new Set(channelIds);
  const published = publishedAll.filter((p) => visible.has(p.channelId));

  // Interactions per published post (latest snapshot per post × metric) → "best times" heatmap weights.
  const recentPub = published.filter((p) => p.at.getTime() > now.getTime() - 90 * DAY);
  const engRows = recentPub.length
    ? await db
        .select({ postId: schema.analyticsSnapshots.publishedPostId, key: schema.analyticsSnapshots.metricKey, value: schema.analyticsSnapshots.value })
        .from(schema.analyticsSnapshots)
        .where(and(inArray(schema.analyticsSnapshots.publishedPostId, recentPub.map((p) => p.id)), inArray(schema.analyticsSnapshots.metricKey, ENGAGEMENT), eq(schema.analyticsSnapshots.available, true)))
        .orderBy(desc(schema.analyticsSnapshots.collectedAt))
    : [];
  const engagement = new Map<string, number>();
  const seen = new Set<string>();
  for (const e of engRows) {
    const k = `${e.postId}:${e.key}`;
    if (!e.postId || seen.has(k) || e.value === null) continue;
    seen.add(k);
    engagement.set(e.postId, (engagement.get(e.postId) ?? 0) + e.value);
  }

  // ── time helpers (workspace time zone) ──
  const dayKey = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const zoned = (x: Date) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(x).map((q) => [q.type, q.value]));
    return { wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday ?? ""), hour: Number(p.hour) };
  };
  const time = new Intl.DateTimeFormat(L, { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const dateShort = new Intl.DateTimeFormat(L, { weekday: "short", day: "numeric", month: "short", timeZone: tz });
  const dayNum = new Intl.DateTimeFormat(L, { day: "numeric", timeZone: tz });
  const when = (iso: string) => {
    const x = new Date(iso);
    const k = dayKey(x);
    const label = k === dayKey(now) ? t.dashboard.today : k === dayKey(new Date(now.getTime() + DAY)) ? t.dashboard.tomorrow : dateShort.format(x);
    return `${label}, ${time.format(x)}`;
  };
  const nf = new Intl.NumberFormat(L, { notation: "compact", maximumFractionDigits: 1 });
  const within = (at: Date, fromDays: number, toDays: number) => at.getTime() > now.getTime() - fromDays * DAY && at.getTime() <= now.getTime() - toDays * DAY;
  const daysBack = (n: number) => Array.from({ length: n }, (_, k) => dayKey(new Date(now.getTime() - (n - 1 - k) * DAY)));
  const perDay = (dates: Date[], keys: string[]) => {
    const m = new Map<string, number>();
    for (const x of dates) m.set(dayKey(x), (m.get(dayKey(x)) ?? 0) + 1);
    return keys.map((k) => m.get(k) ?? 0);
  };

  // ── KPIs ──
  const queued = posts.filter((p) => QUEUED.includes(p.status) && p.scheduled_at);
  const upcoming = queued.filter((p) => new Date(p.scheduled_at!) >= now).sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!));
  const next7 = upcoming.filter((p) => new Date(p.scheduled_at!).getTime() - now.getTime() < 7 * DAY);
  const backKeys = daysBack(R);
  const aheadKeys = Array.from({ length: 14 }, (_, k) => dayKey(new Date(now.getTime() + k * DAY)));
  const pubNow = published.filter((p) => within(p.at, R, 0)).length;
  const pubPrev = published.filter((p) => within(p.at, 2 * R, R)).length;
  const cmNow = received.filter((c) => within(c.at, R, 0)).length;
  const cmPrev = received.filter((c) => within(c.at, 2 * R, R)).length;
  const snapsBy = new Map<string, { value: number; at: Date }[]>();
  for (const s of followerSnaps) if (s.value !== null) snapsBy.set(s.channelId, [...(snapsBy.get(s.channelId) ?? []), { value: s.value, at: s.at }]);
  const followersAt = (x: Date) => {
    let sum = 0;
    let any = false;
    for (const list of snapsBy.values()) {
      const s = list.find((q) => q.at <= x);
      if (s) (sum += s.value), (any = true);
    }
    return any ? sum : null;
  };
  const followers = followersAt(now);
  const followersStart = followersAt(new Date(now.getTime() - R * DAY));

  const longLabel = new Intl.DateTimeFormat(L, { weekday: "short", day: "numeric", month: "short", timeZone: tz });

  // ── channel mix: published in range + upcoming targets, per network ──
  const mixCount = new Map<string, number>();
  for (const p of published) if (within(p.at, R, 0)) mixCount.set(p.platform, (mixCount.get(p.platform) ?? 0) + 1);
  for (const p of upcoming) for (const tg of p.targets) {
    const c = chan.get(tg.account_id);
    if (c) mixCount.set(c.platform, (mixCount.get(c.platform) ?? 0) + 1);
  }
  const mix: DonutSeg[] = [...mixCount.entries()].sort((a, b) => b[1] - a[1]).map(([p, v]) => ({ key: p, label: NETWORK_NAMES[p] ?? p, value: v, color: networkColor(p) === "#000000" ? "var(--ink)" : networkColor(p) }));
  const mixTotal = mix.reduce((a, s) => a + s.value, 0);

  // ── this week: next 7 days, day columns ──
  const week = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(now.getTime() + i * DAY);
    const k = dayKey(dt);
    return { k, dt, items: upcoming.filter((p) => dayKey(new Date(p.scheduled_at!)) === k) };
  });

  // ── best times: weekday × 2h buckets over 90 days ──
  const useEng = engagement.size > 0;
  const grid = Array.from({ length: 7 }, () => Array(12).fill(0) as number[]);
  for (const p of recentPub) {
    const z = zoned(p.at);
    const row = grid[z.wd];
    if (row) row[Math.floor(z.hour / 2)] = (row[Math.floor(z.hour / 2)] ?? 0) + (useEng ? (engagement.get(p.id) ?? 0) : 1);
  }
  const wdNames = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(L, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i))));
  const hourCols = Array.from({ length: 12 }, (_, i) => String(i * 2).padStart(2, "0"));

  // ── setup checklist ──
  const steps = [
    { done: channels.length > 0, icon: Plug, title: d.stepConnect, hint: d.stepConnectHint, href: "/app/channels" },
    { done: posts.length > 0, icon: PenSquare, title: d.stepPost, hint: d.stepPostHint, href: "/app/compose/post" },
    { done: slots.length > 0, icon: Clock3, title: d.stepSlots, hint: d.stepSlotsHint, href: channels[0] ? `/app/channels/${channels[0].id}/queue` : "/app/channels" },
    { done: members > 1, icon: UsersRound, title: d.stepTeam, hint: d.stepTeamHint, href: "/app/team?invite=1" },
    { done: startPages > 0, icon: Link2, title: d.stepStart, hint: d.stepStartHint, href: "/app/start-page" },
  ];
  const doneSteps = steps.filter((s) => s.done).length;

  const drafts = posts.filter((p) => p.status === "DRAFT" || p.status === "CHANGES_REQUESTED").sort((a, b) => b.created_at.localeCompare(a.created_at));
  const thumbs = await postThumbs(db, ctx.organization.id, [...drafts.slice(0, 3), ...upcoming.slice(0, 5), ...week.flatMap((w) => w.items.slice(0, 3))].map((p) => p.id));
  const failed = posts.filter((p) => p.status === "FAILED_FINAL" || p.status === "FAILED_RETRYABLE");
  const reauth = channels.filter((c) => c.status === "needs_reauth");
  const firstTarget = (p: (typeof posts)[number]) => chan.get(p.targets[0]?.account_id ?? "");
  const slotsBy = new Map<string, number>();
  for (const s of slots) slotsBy.set(s.channelId, (slotsBy.get(s.channelId) ?? 0) + 1);
  const queueBy = new Map<string, number>();
  for (const p of upcoming) for (const tg of p.targets) queueBy.set(tg.account_id, (queueBy.get(tg.account_id) ?? 0) + 1);

  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: tz }).format(now));
  const greeting = hour < 11 ? t.dashboard.greetMorning : hour < 18 ? t.dashboard.greetDay : t.dashboard.greetEvening;
  const firstName = ctx.user.name.split(/\s+/)[0] ?? ctx.user.name;

  // ── capsule chart: 6 days back, today, 7 ahead ──
  const wdShort = new Intl.DateTimeFormat(L, { weekday: "short", timeZone: tz });
  const capsuleDays = Array.from({ length: 14 }, (_, i) => {
    const k = i - 6;
    const dt = new Date(now.getTime() + k * DAY);
    const key = dayKey(dt);
    const pub = published.filter((p) => dayKey(p.at) === key).length;
    const sch = upcoming.filter((p) => dayKey(new Date(p.scheduled_at!)) === key).length;
    return { key, weekday: k === 0 ? d.today : wdShort.format(dt), label: longLabel.format(dt), value: k < 0 ? pub : k === 0 ? pub + sch : sch, future: k > 0, today: k === 0 };
  });
  const nextUndone = steps.find((s) => !s.done);
  const mixMax = Math.max(1, ...mix.map((s) => s.value));

  const Delta = ({ cur, prev, light }: { cur: number; prev: number; light?: boolean }) => {
    const pct = prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / prev) * 100);
    const up = pct === null || pct > 0;
    const flat = pct === 0;
    const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
    const tone = light ? "bg-white/25 text-white" : flat ? "bg-white/70 text-ink-3 dark:bg-white/10" : up ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad";
    return (
      <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold tabular-nums ${tone}`}>
        <Icon className="size-3" aria-hidden />
        {pct === null ? d.new : `${pct > 0 ? "+" : ""}${pct}%`}
      </span>
    );
  };
  const Head = ({ id, title, sub, action, icon: Icon }: { id: string; title: string; sub?: string; action?: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) => (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && (
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-bg">
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <h2 id={id} className="font-display text-[1.05rem] font-bold leading-tight tracking-tight">
            {title}
          </h2>
          {sub && <p className="mt-0.5 text-xs text-ink-3">{sub}</p>}
        </div>
      </div>
      {action}
    </div>
  );
  const More = ({ href, label = d.viewAll, light }: { href: string; label?: string; light?: boolean }) => (
    <Link href={href} className={`group inline-flex shrink-0 items-center gap-1.5 rounded-full py-1 pr-1 pl-3 text-xs font-semibold transition-colors ${light ? "bg-white/15 text-white hover:bg-white/25" : "bg-surface-2 text-ink-2 hover:text-ink"}`}>
      {label}
      <span className={`grid size-6 place-items-center rounded-full transition-transform group-hover:translate-x-0.5 ${light ? "bg-white text-[#0e0f12]" : "bg-ink text-bg"}`}>
        <ArrowRight className="size-3.5" aria-hidden />
      </span>
    </Link>
  );
  const Row = ({ href, children }: { href: string; children: React.ReactNode }) => (
    <Link href={href} className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] px-2 py-2.5 transition-colors hover:bg-surface-2 sm:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto]">
      {children}
    </Link>
  );
  const statusChip = (s: string) => {
    const tone = s === "PENDING_APPROVAL" || s === "CHANGES_REQUESTED" ? "bg-warn-soft text-warn" : s === "DRAFT" ? "bg-surface-2 text-ink-2" : "bg-takt-soft text-takt";
    return <span className={`chip justify-self-start ${tone}`}>{t.status[s as keyof typeof t.status] ?? s}</span>;
  };

  const upcomingRows =
    upcoming.length === 0 ? (
      <EmptyMini icon={CalendarClock} text={t.dashboard.emptyUpcoming} cta={{ href: "/app/compose/post", label: d.createPost }} />
    ) : (
      <div>
        <div className="hidden grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] gap-3 px-2 pb-2 text-[0.7rem] font-medium text-ink-3 sm:grid">
          <span>{d.colPost}</span>
          <span>{d.colWhen}</span>
          <span>{d.colStatus}</span>
          <span className="w-11" />
        </div>
        <ul className="divide-y divide-line">
          {upcoming.slice(0, 5).map((p) => {
            const c = firstTarget(p);
            return (
              <li key={p.id}>
                <Row href={`/app/posts/${p.id}`}>
                  <span className="flex min-w-0 items-center gap-3">
                    {c ? <NetworkIcon platform={c.platform} badge size={30} /> : <span className="size-[30px] rounded-full bg-surface-2" />}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{p.caption || "—"}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {c?.display_name}
                        {p.targets.length > 1 ? ` +${p.targets.length - 1}` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="text-xs font-medium tabular-nums text-ink-2">{when(p.scheduled_at!)}</span>
                  <span className="hidden sm:block">{statusChip(p.status)}</span>
                  <PostThumb thumb={thumbs.get(p.id)} size={44} />
                </Row>
              </li>
            );
          })}
        </ul>
      </div>
    );
  const draftRows =
    drafts.length === 0 ? (
      <EmptyMini icon={PenSquare} text={d.draftsEmpty} cta={{ href: "/app/compose/post", label: d.createPost }} />
    ) : (
      <ul className="divide-y divide-line">
        {drafts.slice(0, 5).map((p) => {
          const c = firstTarget(p);
          const overdue = p.scheduled_at && new Date(p.scheduled_at) < now;
          return (
            <li key={p.id}>
              <Row href={`/app/posts/${p.id}`}>
                <span className="flex min-w-0 items-center gap-3">
                  {c ? <NetworkIcon platform={c.platform} badge size={30} /> : <span className="size-[30px] rounded-full bg-surface-2" />}
                  <span className="block truncate text-sm font-semibold">{p.caption || "—"}</span>
                </span>
                <span className="text-xs font-medium tabular-nums text-ink-2">{p.scheduled_at ? when(p.scheduled_at) : d.noDate}</span>
                <span className="hidden sm:block">{overdue ? <span className="chip bg-warn-soft text-warn">{t.dashboard.overdue}</span> : statusChip(p.status)}</span>
                <PostThumb thumb={thumbs.get(p.id)} size={44} />
              </Row>
            </li>
          );
        })}
      </ul>
    );
  const inboxRows =
    openComments.length === 0 ? (
      <EmptyMini icon={Inbox} text={d.inboxEmpty} />
    ) : (
      <ul className="divide-y divide-line">
        {openComments.slice(0, 5).map((cm) => {
          const c = chan.get(cm.channelId);
          return (
            <li key={cm.id}>
              <Link href={`/app/community?thread=${cm.threadId}`} className="group flex items-center gap-3 rounded-[14px] px-2 py-2.5 transition-colors hover:bg-surface-2">
                <span className="relative shrink-0">
                  <span className="grid size-9 place-items-center rounded-full bg-takt-soft font-display text-sm font-bold text-takt">{(cm.author ?? "?").slice(0, 1).toUpperCase()}</span>
                  {c && (
                    <span className="absolute -right-1 -bottom-1">
                      <NetworkIcon platform={c.platform} badge size={16} />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2 text-xs">
                    <span className="truncate font-semibold">@{cm.author ?? "—"}</span>
                    <span className="shrink-0 text-ink-3">{when(cm.at.toISOString())}</span>
                  </span>
                  <span className="block truncate text-sm text-ink-2">{cm.body}</span>
                </span>
                <span className="text-xs font-semibold text-takt opacity-0 transition-opacity group-hover:opacity-100">{d.reply}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    );

  // ── glass dashboard series ──
  const back7 = daysBack(7);
  const pub7 = perDay(published.map((p) => p.at), back7);
  const cm14 = perDay(received.map((c) => c.at), daysBack(14));
  const fol7 = back7.map((_, k) => followersAt(new Date(now.getTime() - (6 - k) * DAY)) ?? 0);
  const gaugeMax = Math.max(7, slots.length, next7.length);
  const pubPerDay = perDay(published.map((p) => p.at), backKeys);
  const schedPerDay = perDay(upcoming.map((p) => new Date(p.scheduled_at!)), aheadKeys);
  const shortFmt = (dt: Date) => (R > 30 ? new Intl.DateTimeFormat(L, { day: "numeric", month: "numeric", timeZone: tz }).format(dt) : dayNum.format(dt));
  const rhythm = [
    ...backKeys.map((_, i) => {
      const dt = new Date(now.getTime() - (R - 1 - i) * DAY);
      return { label: longLabel.format(dt), short: shortFmt(dt), value: pubPerDay[i] ?? 0, future: false, today: i === R - 1 };
    }),
    ...aheadKeys.slice(1, 8).map((_, i) => {
      const dt = new Date(now.getTime() + (i + 1) * DAY);
      return { label: longLabel.format(dt), short: shortFmt(dt), value: schedPerDay[i + 1] ?? 0, future: true, today: false };
    }),
  ];
  const nextPost = upcoming[0];
  const nextCh = nextPost ? firstTarget(nextPost) : undefined;
  const nextThumb = nextPost ? thumbs.get(nextPost.id) : undefined;

  const bars = (vals: number[], shades: [string, string, string]) => {
    const m = Math.max(1, ...vals);
    return (
      <svg viewBox="0 0 100 30" className="h-[30px] w-full" aria-hidden>
        {vals.map((v, i) => {
          const h = v === 0 ? 4 : 6 + (v / m) * 24;
          return <rect key={i} className="tile-bar" style={{ "--i": i } as React.CSSProperties} x={6 + i * 13.5} y={30 - h} width="4" height={h} rx="2" fill={v === 0 ? shades[0] : v === m ? shades[2] : shades[1]} />;
        })}
      </svg>
    );
  };
  const pulse = (vals: number[]) => {
    const m = Math.max(1, ...vals);
    let d = "M2 16";
    vals.forEach((v, i) => {
      const x = 4 + i * (94 / vals.length);
      const amp = v === 0 ? 0 : 4 + (v / m) * 11;
      d += ` L${x.toFixed(1)} 16 L${(x + 2).toFixed(1)} ${16 - amp} L${(x + 4).toFixed(1)} ${16 + amp * 0.7} L${(x + 5.5).toFixed(1)} 16`;
    });
    d += " L98 16";
    return (
      <svg viewBox="0 0 100 30" className="h-[30px] w-full" aria-hidden>
        <path className="tile-pulse" d={d} fill="none" stroke="#ff3b71" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  };
  const gauge = (v: number, max: number) => {
    const f = Math.min(1, v / max);
    return (
      <svg viewBox="0 0 56 34" className="h-[34px] w-[56px]" aria-hidden>
        <path d="M6 30 A22 22 0 0 1 50 30" fill="none" stroke="#e8edf3" strokeWidth="5.5" strokeLinecap="round" />
        <path className="tile-gauge" d="M6 30 A22 22 0 0 1 50 30" fill="none" stroke="#22c55e" strokeWidth="5.5" strokeLinecap="round" pathLength={100} strokeDasharray={`${Math.max(f * 100, v > 0 ? 6 : 0)} 100`} />
      </svg>
    );
  };

  const tiles = [
    { key: "pub", label: d.kpiPublished, icon: Send, badge: "bg-[#e7efff] text-takt", value: String(pubNow), valueCls: "text-takt", unit: fill(d.unitDays, { n: String(R) }), graph: bars(pub7, ["#dbe6fb", "#7ea6f0", "#0047ab"]), href: "/app/insights", delta: <Delta cur={pubNow} prev={pubPrev} /> },
    { key: "cm", label: d.kpiComments, icon: MessageCircle, badge: "bg-[#fdeef3] text-[#ff3b71]", value: String(cmNow), valueCls: "text-[#ff3b71]", unit: fill(d.unitDays, { n: String(R) }), graph: pulse(cm14), href: "/app/community", delta: <Delta cur={cmNow} prev={cmPrev} /> },
    { key: "sch", label: d.kpiScheduled, icon: CalendarCheck, badge: "bg-[#ecfdf3] text-[#16a34a]", value: String(next7.length), valueCls: "text-[#16a34a]", unit: d.unitPosts, graph: gauge(next7.length, gaugeMax), href: "/app/publish", delta: null },
    { key: "fol", label: d.kpiFollowers, icon: UsersRound, badge: "bg-[#f1edff] text-[#7c6cf0]", value: followers === null ? "—" : nf.format(followers), valueCls: "text-[#7c6cf0]", unit: followers === null ? d.noDataShort : d.kpiFollowers, graph: bars(fol7, ["#ebe7ff", "#b8adf7", "#7c6cf0"]), href: "/app/insights", delta: null },
  ];

  return (
    <div className="space-y-4">
      {/* ── greeting ── */}
      <header className="rise flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(1.4rem,2.2vw,1.8rem)] leading-tight font-medium tracking-tight">
            {fill(greeting, { name: "" }).replace(/[,!]\s*$/, "").replace(/,\s*$/, "")}, <strong className="font-bold">{firstName}</strong>{" "}
            <span className="wave-hand inline-block origin-[70%_80%]" aria-hidden>
              👋
            </span>
          </h1>
          <p className="mt-0.5 text-xs text-ink-3">{fill(d.summaryLine, { scheduled: String(next7.length), comments: String(openComments.length) })}</p>
        </div>
        <div className="flex items-center gap-2">
          <nav aria-label={d.rangeLabel} className="glass-pill flex rounded-full p-1">
            {RANGES.map((r) => (
              <Link key={r} href={r === 30 ? "/app" : `/app?range=${r}`} scroll={false} aria-current={r === R ? "true" : undefined} className={`min-w-[3rem] rounded-full px-3 py-1.5 text-center text-xs font-semibold transition-colors duration-300 ${r === R ? "bg-takt text-white shadow-[0_4px_12px_-4px_var(--takt)]" : "text-ink-2 hover:text-ink"}`}>
                {fill(d.rangeDays, { n: String(r) })}
              </Link>
            ))}
          </nav>
          <Link href="/app/compose/post" className="btn btn-primary !min-h-[40px] text-sm">
            <Plus className="size-4" aria-hidden /> {d.createPost}
          </Link>
        </div>
      </header>

      {(failed.length > 0 || reauth.length > 0) && (
        <section className="space-y-2" aria-label={d.issues}>
          {reauth.map((c) => (
            <Notice key={c.id} tone="bad">
              <Link href="/app/channels" className="flex items-center gap-2 underline-offset-4 hover:underline">
                <AlertTriangle className="size-4" aria-hidden /> {c.display_name}: {t.health.reauth}
              </Link>
            </Notice>
          ))}
          {failed.slice(0, 3).map((f) => (
            <Notice key={f.id} tone="bad">
              <Link href={`/app/posts/${f.id}`} className="underline-offset-4 hover:underline">
                {f.caption.slice(0, 70) || f.id} — {f.targets.find((x) => x.error_code)?.error_code}
              </Link>
            </Notice>
          ))}
        </section>
      )}

      {/* ── 4 white metric tiles ── */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label={t.dashboard.summary}>
        {tiles.map((k, i) => (
          <Link key={k.key} href={k.href} className="tile tile-in flex h-[118px] flex-col justify-between p-3.5" style={{ "--i": i } as React.CSSProperties}>
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-[0.8rem] font-semibold">{k.label}</span>
              <span className={`grid size-7 shrink-0 place-items-center rounded-full ${k.badge}`}>
                <k.icon className="size-3.5" strokeWidth={2.4} />
              </span>
            </span>
            <span className="flex h-[34px] items-center justify-center">{k.graph}</span>
            <span className="flex items-baseline gap-1.5">
              <span className={`font-display text-[1.2rem] font-bold tabular-nums ${k.valueCls}`}>{k.value}</span>
              <span className="truncate text-[0.7rem] text-ink-3">{k.unit}</span>
              {k.delta && <span className="ml-auto">{k.delta}</span>}
            </span>
          </Link>
        ))}
      </section>

      {/* ── activity + next post ── */}
      <div className="grid gap-3 xl:grid-cols-[1.35fr_1fr]">
        <section className="tile tile-in p-4" style={{ "--i": 4 } as React.CSSProperties} aria-labelledby="rhythm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 id="rhythm" className="text-sm font-bold">
              {d.rhythmTitle}
            </h2>
            <span className="flex items-center gap-3 text-[0.68rem] text-ink-3">
              <span className="flex items-center gap-1.5">
                <span className="h-[3px] w-3.5 rounded-full bg-takt" /> {d.published}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0 w-3.5 border-t-2 border-dashed border-ink-2" /> {d.scheduled}
              </span>
            </span>
          </div>
          <RhythmChart points={rhythm} labels={{ published: d.published, scheduled: d.scheduled, today: d.today, posts: d.posts }} />
        </section>

        <Link
          href={nextPost ? `/app/posts/${nextPost.id}` : channels.length === 0 ? "/app/channels" : "/app/compose/post"}
          className="tile tile-in group relative flex min-h-[220px] overflow-hidden"
          style={{ "--i": 5 } as React.CSSProperties}
        >
          <div className="relative z-[1] flex w-[52%] flex-col p-4">
            <p className="text-[0.7rem] font-bold tracking-[0.12em] text-takt uppercase">{nextPost ? d.nextTitle : channels.length === 0 ? t.nav.connectChannel : d.createPost}</p>
            <p className="mt-1.5 line-clamp-3 text-[1.05rem] leading-snug font-bold">{nextPost ? nextPost.caption || "—" : channels.length === 0 ? d.heroConnect : d.heroPlan}</p>
            <div className="mt-auto space-y-2 pt-3">
              {nextPost ? (
                <>
                  <p className="font-display text-xl font-bold tabular-nums">{time.format(new Date(nextPost.scheduled_at!))}</p>
                  <p className="flex items-center gap-1.5 text-xs text-ink-3">
                    {nextCh && <NetworkIcon platform={nextCh.platform} badge size={16} />}
                    {when(nextPost.scheduled_at!)}
                  </p>
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-takt px-3.5 py-2 text-xs font-semibold text-white transition-transform group-hover:translate-x-0.5">
                  <Plus className="size-3.5" /> {channels.length === 0 ? t.nav.connectChannel : d.createPost}
                </span>
              )}
            </div>
          </div>
          <div className="absolute inset-y-2 right-2 w-[50%] overflow-hidden rounded-[16px] bg-[#0f1034]">
            {nextThumb ? (
              <PostThumb thumb={nextThumb} size={400} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/brand/mascots-960.webp" alt="" className="size-full scale-[1.35] object-cover transition-transform duration-700 group-hover:scale-[1.45]" />
            )}
          </div>
        </Link>
      </div>

      {/* ── drafts ── */}
      <section aria-labelledby="drafts-h">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 id="drafts-h" className="flex items-center gap-2 text-sm font-bold">
            <span className="h-4 w-1 rounded-full bg-takt" /> {drafts.length ? d.draftsTitle : d.quickTitle}
          </h2>
          {drafts.length > 0 && (
            <Link href="/app/publish?tab=drafts" className="text-xs font-semibold text-ink-2 hover:text-ink">
              {d.viewAll}
            </Link>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {(drafts.length
            ? drafts.slice(0, 3).map((p, i) => ({ key: p.id, href: `/app/posts/${p.id}`, title: p.caption || "—", sub: p.scheduled_at ? when(p.scheduled_at) : d.noDate, pill: t.status[p.status as keyof typeof t.status] ?? p.status, icon: null as React.ComponentType<{ className?: string }> | null, thumb: thumbs.get(p.id), hot: i === 1 }))
            : [
                { key: "idea", href: "/app/ideas?new=1", title: d.newIdea, sub: d.quickIdea, pill: "N", icon: Lightbulb, thumb: undefined, hot: false },
                { key: "post", href: "/app/compose/post", title: d.createPost, sub: d.quickPost, pill: "→", icon: PenSquare, thumb: undefined, hot: true },
                { key: "ch", href: "/app/channels", title: t.nav.connectChannel, sub: d.quickChannel, pill: "+", icon: Plug, thumb: undefined, hot: false },
              ]
          ).map((c, i) => (
            <Link key={c.key} href={c.href} className={`tile tile-in group flex min-h-[96px] items-center gap-3 p-3.5 ${c.hot ? "!bg-takt !text-white" : ""}`} style={{ "--i": 6 + i } as React.CSSProperties}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{c.title}</span>
                <span className={`mt-0.5 line-clamp-2 block text-[0.72rem] ${c.hot ? "text-white/80" : "text-ink-3"}`}>{c.sub}</span>
                <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[0.65rem] font-semibold ${c.hot ? "bg-white/20" : "bg-surface-2 text-ink-2"}`}>{c.pill}</span>
              </span>
              {c.thumb ? (
                <span className="overflow-hidden rounded-full ring-4 ring-white/60">
                  <PostThumb thumb={c.thumb} size={58} />
                </span>
              ) : c.icon ? (
                <span className={`grid size-14 shrink-0 place-items-center rounded-full transition-transform duration-500 group-hover:rotate-[-10deg] ${c.hot ? "bg-white/20" : "bg-surface-2 text-takt"}`}>
                  <c.icon className="size-6" />
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      </section>

      {/* ── best times + channel mix ── */}
      <div className="grid gap-3 xl:grid-cols-[1.35fr_1fr]">
        <section className="tile tile-in p-4" style={{ "--i": 9 } as React.CSSProperties} aria-labelledby="times">
          <h2 id="times" className="text-sm font-bold">
            {d.timesTitle}
          </h2>
          <p className="mb-3 text-[0.7rem] text-ink-3">{useEng ? d.timesSubEng : d.timesSubCount}</p>
          <Heatmap grid={grid} rows={wdNames} cols={hourCols} label={d.timesTitle} valueLabel={(v) => fill(useEng ? d.interactions : d.postsN, { n: String(v) })} />
        </section>
        <section className="tile tile-in flex flex-col p-4" style={{ "--i": 10 } as React.CSSProperties} aria-labelledby="mix">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="mix" className="text-sm font-bold">
              {d.mixTitle}
            </h2>
            <Link href="/app/channels" className="text-xs font-semibold text-ink-2 hover:text-ink">
              {d.manage}
            </Link>
          </div>
          <ul className="flex flex-1 flex-col justify-center gap-3">
            {(mix.length ? mix.slice(0, 4) : ["instagram_business", "linkedin_page", "tiktok"].map((p) => ({ key: p, label: NETWORK_NAMES[p] ?? p, value: 0, color: "" }))).map((s, i) => (
              <li key={s.key}>
                <p className="mb-1 flex items-center gap-2 text-xs font-medium">
                  <NetworkIcon platform={s.key} badge size={18} />
                  <span className="flex-1 truncate">{s.label}</span>
                  <span className="font-bold tabular-nums">{s.value}</span>
                </p>
                <Capsule pct={(s.value / mixMax) * 100} active={i === 0 && s.value > 0} delay={0.4 + i * 0.1} />
              </li>
            ))}
          </ul>
          {mix.length === 0 && <p className="mt-2 text-[0.7rem] text-ink-3">{d.mixEmpty}</p>}
        </section>
      </div>
    </div>
  );
}

function EmptyMini({ icon: Icon, text, cta }: { icon: React.ComponentType<{ className?: string }>; text: string; cta?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[16px] bg-surface-2/60 px-4 py-9 text-center">
      <span className="mb-3 grid size-10 place-items-center rounded-full bg-surface text-ink-3 ring-1 ring-line">
        <Icon className="size-[18px]" />
      </span>
      <p className="text-sm font-medium text-ink-2">{text}</p>
      {cta && (
        <Link href={cta.href} className="btn btn-primary mt-4 !min-h-[38px] text-sm">
          <Plus className="size-4" aria-hidden /> {cta.label}
        </Link>
      )}
    </div>
  );
}
