import Link from "next/link";
import { cookies } from "next/headers";
import { Bell } from "lucide-react";
import { CommandPalette } from "@/components/command-palette";
import { ThemeToggle } from "@/components/theme-toggle";
import { and, asc, count, eq, gte, inArray, isNull, sql, schema } from "@sichttakt/db";
import { getEntitlements, isPlatformConfigured, PLATFORM_ENV } from "@sichttakt/core";
import type { Platform } from "@sichttakt/shared";
import { Sidebar } from "@/components/sidebar";
import { LiveClock } from "@/components/live-clock";
import { RightPanel, type PanelData } from "@/components/dash/right-panel";
import { postThumbs } from "@/lib/thumbs";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext, listVisibleChannels } from "@/lib/server";
import { switchWorkspaceAction } from "./actions";
import { logoutAction } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const [{ value: unread } = { value: 0 }] = await ctx.svc.db
    .select({ value: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, ctx.user.id), eq(schema.notifications.organizationId, ctx.organization.id), isNull(schema.notifications.readAt)));

  // Sidebar data: the brand's channels with their queue size, scheduled posts and unanswered comments.
  const db = ctx.svc.db;
  const [channelRows, ent] = await Promise.all([listVisibleChannels(ctx, ctx.workspace.id), getEntitlements(db, ctx.organization.id)]);
  const active = channelRows.filter((c) => c.status !== "disconnected");
  const queued = active.length
    ? await db
        .select({ channelId: schema.postTargets.channelId, n: count() })
        .from(schema.postTargets)
        .where(and(inArray(schema.postTargets.channelId, active.map((c) => c.id)), inArray(schema.postTargets.status, ["SCHEDULED", "APPROVED", "PENDING_APPROVAL"])))
        .groupBy(schema.postTargets.channelId)
    : [];
  const [{ value: unanswered } = { value: 0 }] = await db
    .select({ value: count() })
    .from(schema.comments)
    .innerJoin(schema.commentThreads, eq(schema.commentThreads.id, schema.comments.threadId))
    .where(and(eq(schema.commentThreads.workspaceId, ctx.workspace.id), eq(schema.commentThreads.status, "open"), eq(schema.comments.isOwn, false), isNull(schema.comments.repliedAt), isNull(schema.comments.hiddenAt)));
  const [{ value: scheduledPosts } = { value: 0 }] = await db
    .select({ value: count() })
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, ctx.workspace.id), isNull(schema.posts.deletedAt), sql`${schema.posts.status} in ('SCHEDULED','APPROVED','PENDING_APPROVAL')`));
  const [{ value: memberCount } = { value: 0 }] = await db.select({ value: count() }).from(schema.memberships).where(and(eq(schema.memberships.organizationId, ctx.organization.id), sql`${schema.memberships.userId} is not null`));
  const [{ value: channelCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(schema.channels)
    .where(and(eq(schema.channels.organizationId, ctx.organization.id), isNull(schema.channels.disconnectedAt), eq(schema.channels.isSandbox, false)));
  const sidebarChannels = active.map((c) => ({ id: c.id, name: c.display_name, platform: c.platform, avatarUrl: c.avatar_url ?? null, scheduled: queued.find((q) => q.channelId === c.id)?.n ?? 0, needsReauth: c.status === "needs_reauth" }));

  // Dashboard side panel (shown on /app only): scheduled + published days for the calendar, next posts, counters.
  const tz = ctx.workspace.timezone;
  const dayKey = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const now = new Date();
  const [queuedRows, pubRows, [{ value: draftCount } = { value: 0 }]] = await Promise.all([
    db
      .select({ id: schema.posts.id, caption: schema.posts.caption, at: schema.posts.scheduledAt })
      .from(schema.posts)
      .where(and(eq(schema.posts.workspaceId, ctx.workspace.id), isNull(schema.posts.deletedAt), inArray(schema.posts.status, ["SCHEDULED", "APPROVED", "PENDING_APPROVAL"]), gte(schema.posts.scheduledAt, new Date(now.getTime() - 864e5))))
      .orderBy(asc(schema.posts.scheduledAt))
      .limit(300),
    db
      .select({ at: schema.publishedPosts.publishedAt, channelId: schema.publishedPosts.channelId })
      .from(schema.publishedPosts)
      .where(and(eq(schema.publishedPosts.workspaceId, ctx.workspace.id), gte(schema.publishedPosts.publishedAt, new Date(now.getTime() - 120 * 864e5)))),
    db.select({ value: count() }).from(schema.posts).where(and(eq(schema.posts.workspaceId, ctx.workspace.id), isNull(schema.posts.deletedAt), inArray(schema.posts.status, ["DRAFT", "CHANGES_REQUESTED"]))),
  ]);
  const upcomingRows = queuedRows.filter((p) => p.at && p.at >= now).slice(0, 4);
  const firstTargets = upcomingRows.length ? await db.select({ postId: schema.postTargets.postId, channelId: schema.postTargets.channelId }).from(schema.postTargets).where(inArray(schema.postTargets.postId, upcomingRows.map((p) => p.id))) : [];
  const panelThumbs = await postThumbs(db, ctx.organization.id, upcomingRows.map((p) => p.id));
  const visibleIds = new Set(channelRows.map((c) => c.id));
  const initialsOf = (s: string) => s.split(/s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
  const panel: PanelData = {
    org: { name: ctx.organization.name, workspace: ctx.workspace.name, initials: initialsOf(ctx.organization.name) },
    stats: { channels: channelCount, scheduled: queuedRows.filter((p) => p.at && p.at >= now && p.at.getTime() - now.getTime() < 7 * 864e5).length, drafts: draftCount },
    scheduledDays: [...new Set(queuedRows.filter((p) => p.at).map((p) => dayKey(p.at!)))],
    publishedDays: [...new Set(pubRows.filter((p) => visibleIds.has(p.channelId)).map((p) => dayKey(p.at)))],
    today: dayKey(now),
    next: upcomingRows.map((p) => {
      const ch = channelRows.find((c) => c.id === firstTargets.find((t) => t.postId === p.id)?.channelId);
      const th = panelThumbs.get(p.id);
      return { id: p.id, caption: p.caption.slice(0, 120), at: p.at!.toISOString(), platform: ch?.platform ?? null, thumb: th ? { assetId: th.assetId, kind: th.kind } : null };
    }),
    locale: intlLocale(locale),
    tz,
  };

  const switcher = (
    <form action={switchWorkspaceAction} className="rounded-[14px] border border-line bg-bg p-2.5">
      <label htmlFor="ws" className="eyebrow block px-1 pb-1">
        {ctx.organization.name} · {t.nav.workspace}
      </label>
      <div className="flex gap-1.5">
        <select id="ws" name="workspaceId" defaultValue={ctx.workspace.id} className="input !min-h-[38px] !py-1 font-semibold">
          {ctx.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <button className="btn btn-ghost !min-h-[38px] !px-2.5 text-xs">OK</button>
      </div>
    </form>
  );

  return (
    <div className="relative min-h-dvh">
      <div className="aurora" aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </div>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:p-2">
        Zum Inhalt springen
      </a>
      <div className="shell-in relative z-[1] mx-auto flex max-w-[1680px] gap-4 p-2 sm:p-3 lg:h-dvh lg:p-5">
        <Sidebar
          labels={{ ...t.nav, logout: t.auth.logout, reauth: t.health.reauth }}
          workspaceSwitcher={ctx.workspaces.length > 1 ? switcher : null}
          org={{ name: ctx.organization.name, plan: `${t.billing.current}: ${ent.planCode.charAt(0).toUpperCase()}${ent.planCode.slice(1)}`, planCode: ent.planCode, userName: ctx.user.name, userEmail: ctx.user.email }}
          channels={sidebarChannels}
          counts={{ scheduled: scheduledPosts, unanswered }}
          initialOpen={(await cookies()).get("st_rail")?.value === "1"}
          usage={{ channels: { used: channelCount, limit: ent.limits.channels }, members: { used: memberCount, limit: ent.limits.users } }}
          superAdmin={ctx.actor.kind === "user" && ctx.actor.isSuperAdmin}
          logoutAction={logoutAction}
          connect={{
            configured: Object.fromEntries(Object.keys(PLATFORM_ENV).map((p) => [p, isPlatformConfigured(ctx.svc.config, p as Platform)])),
            sandbox: ctx.svc.config.SANDBOX_ENABLED === "true",
            labels: t.connectUi,
          }}
        />
          <div id="scroller" className="glass relative min-w-0 flex-1 rounded-[28px] lg:overflow-y-auto lg:overscroll-contain lg:rounded-[32px] lg:[scrollbar-width:none]">
          <header className="sticky top-0 z-30 flex h-[72px] items-center gap-3 rounded-t-[28px] px-4 backdrop-blur-xl lg:rounded-t-[32px] lg:px-7">
            <div className="min-w-0 flex-1">
              <CommandPalette l={t.palette} nav={t.nav} />
            </div>
            <LiveClock tz={ctx.workspace.timezone} locale={intlLocale(locale)} />
            <ThemeToggle labels={{ light: t.palette.toLight, dark: t.palette.toDark }} />
            <Link href="/app/notifications" className="bell-host glass-pill relative grid size-10 place-items-center rounded-full" aria-label={`${t.palette.notifications} (${unread})`}>
              <Bell className="bell-icon size-[18px]" />
              {unread > 0 && <span className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-[#ff3b71] px-1 text-[0.65rem] font-bold text-white">{unread}</span>}
            </Link>
          </header>
          <main id="main" className="mx-auto w-full max-w-[1400px] px-4 pt-2 pb-28 lg:px-7 lg:pb-8">
            {children}
          </main>
        </div>
        <RightPanel data={panel} l={t.panel} />
      </div>
    </div>
  );
}
