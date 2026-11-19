"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MadeBy } from "./made-by";
import {
  Home,
  Lightbulb,
  CalendarDays,
  MessagesSquare,
  LineChart,
  Plus,
  PenSquare,
  Clapperboard,
  Images,
  FileText,
  Link2,
  Scissors,
  Users,
  Plug,
  UsersRound,
  KeyRound,
  CreditCard,
  Palette,
  Activity,
  ScrollText,
  Settings,
  ShieldCheck,
  Blocks,
  LogOut,
  LayoutGrid,
  X,
  Sparkles,
  PanelLeftOpen,
  PanelLeftClose,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "./logo";
import { ChannelAvatar } from "./network-icon";
import { ConnectChannelDialog } from "./connect-channel-dialog";
import type { Messages } from "@/i18n/de";

export type NavLabels = Record<string, string>;
export type SidebarChannel = { id: string; name: string; platform: string; avatarUrl: string | null; scheduled: number; needsReauth: boolean };
export type SidebarUsage = { channels: { used: number; limit: number | null }; members: { used: number; limit: number | null } };
type Item = { href: string; key: string; icon: LucideIcon; badge?: number };

const W_CLOSED = 72;
const W_OPEN = 236;
const RAIL_COOKIE = "st_rail";
const WIDTH = { type: "spring", stiffness: 380, damping: 32, mass: 0.8 } as const;
const DOCK = { type: "spring", stiffness: 420, damping: 24 } as const;
const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};
/** macOS-dock magnification: hovered icon 1.25, neighbours 1.12 / 1.04. */
const dockScale = (hovered: number | null, i: number) => {
  if (hovered === null) return 1;
  const d = Math.abs(hovered - i);
  return d === 0 ? 1.25 : d === 1 ? 1.12 : d === 2 ? 1.04 : 1;
};

/**
 * Floating glass capsule navigation. Collapsed it is an icon dock (icons magnify like the macOS dock, labels pop out
 * as pills); open it springs wider and shows labels. Toggle sits at the bottom (button or "["), remembered in a
 * cookie. "N" opens the New menu. Account, plan usage and settings live in the avatar menu. Phones get a bottom bar.
 */
export function Sidebar({
  labels,
  workspaceSwitcher,
  org,
  channels,
  counts,
  usage,
  initialOpen = false,
  superAdmin = false,
  logoutAction,
  connect,
}: {
  labels: NavLabels;
  workspaceSwitcher: React.ReactNode;
  org: { name: string; plan: string; planCode: string; userName: string; userEmail: string };
  channels: SidebarChannel[];
  counts: { scheduled: number; unanswered: number };
  usage: SidebarUsage;
  initialOpen?: boolean;
  superAdmin?: boolean;
  logoutAction: () => Promise<void>;
  connect: { configured: Record<string, boolean>; sandbox: boolean; labels: Messages["connectUi"] };
}) {
  const path = usePathname();
  const [open, setOpen] = useState(initialOpen);
  const [connectOpen, setConnectOpen] = useState(false);
  const [menu, setMenu] = useState<null | "new" | "account">(null);
  const [sheet, setSheet] = useState(false);
  const [dock, setDock] = useState<number | null>(null);

  const isActive = (href: string) => (href === "/app" ? path === "/app" : path === href || path.startsWith(`${href}/`));
  const fmt = (n: number) => (n > 99 ? "99+" : String(n));
  const initials = (s: string) =>
    s
      .split(/\s+/)
      .map((w) => w[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();

  const MAIN: Item[] = [
    { href: "/app", key: "dashboard", icon: Home },
    { href: "/app/ideas", key: "ideas", icon: Lightbulb },
    { href: "/app/publish", key: "publish", icon: CalendarDays, badge: counts.scheduled },
    { href: "/app/community", key: "community", icon: MessagesSquare, badge: counts.unanswered },
    { href: "/app/insights", key: "insights", icon: LineChart },
  ];
  const TOOLS: Item[] = [
    { href: "/app/media", key: "media", icon: Images },
    { href: "/app/reports", key: "reports", icon: FileText },
    { href: "/app/start-page", key: "startPage", icon: Link2 },
    { href: "/app/links", key: "links", icon: Scissors },
  ];
  const ORG: Item[] = [
    { href: "/app/channels", key: "channels", icon: Plug },
    { href: "/app/team", key: "team", icon: UsersRound },
    { href: "/app/integrations", key: "integrations", icon: Blocks },
    { href: "/app/developer", key: "developer", icon: KeyRound },
    { href: "/app/billing", key: "billing", icon: CreditCard },
    { href: "/app/branding", key: "branding", icon: Palette },
    { href: "/app/health", key: "health", icon: Activity },
    { href: "/app/audit", key: "audit", icon: ScrollText },
    { href: "/app/settings", key: "settings", icon: Settings },
    { href: "/app/publish?tab=approvals", key: "clients", icon: Users },
    ...(superAdmin ? [{ href: "/app/admin", key: "admin", icon: ShieldCheck }] : []),
  ];
  const NEW = [
    { href: "/app/compose/post", label: labels.composePost, icon: PenSquare },
    { href: "/app/compose/reel", label: labels.compose, icon: Clapperboard },
    { href: "/app/ideas?new=1", label: labels.newIdea, icon: Lightbulb },
  ];

  const toggle = useCallback(() => {
    setOpen((v) => {
      document.cookie = `${RAIL_COOKIE}=${v ? "0" : "1"}; path=/; max-age=31536000; samesite=lax`;
      return !v;
    });
    setDock(null);
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-rail-menu]")) setMenu(null);
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setMenu(null), setSheet(false);
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n" || e.key === "N") (e.preventDefault(), setMenu("new"));
      if (e.key === "[") (e.preventDefault(), toggle());
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", keys);
    };
  }, [toggle]);
  useEffect(() => {
    setMenu(null);
    setSheet(false);
  }, [path]);

  const pct = (u: { used: number; limit: number | null }) => (u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0);
  const pop = { initial: { opacity: 0, x: -8, scale: 0.96 }, animate: { opacity: 1, x: 0, scale: 1 }, exit: { opacity: 0, x: -6, scale: 0.97 }, transition: { type: "spring", stiffness: 420, damping: 30 } } as const;

  /** One rail entry: icon (dock-magnified when collapsed) + label (open) or pill tooltip (collapsed). */
  const entry = (it: Item, i: number) => {
    const active = isActive(it.href);
    const label = labels[it.key] ?? it.key;
    return (
      <li key={it.href} onMouseEnter={() => !open && setDock(i)}>
        <Link
          href={it.href}
          aria-current={active ? "page" : undefined}
          aria-label={label}
          className={`group relative flex items-center rounded-[14px] transition-colors duration-200 ${open ? "h-11 gap-3 px-3" : "size-[42px] justify-center"} ${
            active ? "bg-takt text-white shadow-[0_6px_16px_-2px_color-mix(in_srgb,var(--takt)_55%,transparent)]" : "text-white/70 hover:bg-white/15 hover:text-white"
          }`}
        >
          <motion.span animate={{ scale: open ? 1 : dockScale(dock, i) }} transition={DOCK} className="relative grid shrink-0 place-items-center">
            <it.icon className="size-[19px]" strokeWidth={active ? 2.3 : 1.8} aria-hidden />
            {!!it.badge && <span className="absolute -top-2 -right-2.5 min-w-[16px] rounded-full bg-[#ff3b71] px-1 text-center text-[0.56rem] font-bold leading-4 text-white ring-2 ring-[#16181f]">{fmt(it.badge)}</span>}
          </motion.span>
          {open && (
            <motion.span initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18, delay: 0.06 }} className="min-w-0 flex-1 truncate text-sm font-medium whitespace-nowrap">
              {label}
            </motion.span>
          )}
          {!open && (
            <span className="pointer-events-none absolute left-[56px] z-50 translate-x-[-4px] scale-95 rounded-full border border-white/15 bg-[#12141a]/95 px-3 py-1 text-[0.72rem] font-semibold whitespace-nowrap text-white opacity-0 shadow-lg transition-all duration-150 group-hover:translate-x-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:opacity-100">
              {label}
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <>
      <ConnectChannelDialog open={connectOpen} onClose={() => setConnectOpen(false)} configured={connect.configured} sandbox={connect.sandbox} l={connect.labels} />

      {/* ── desktop: floating glass capsule ── */}
      <motion.aside
        initial={false}
        animate={{ width: open ? W_OPEN : W_CLOSED }}
        transition={WIDTH}
        className={`glass-rail relative z-30 hidden shrink-0 flex-col py-5 lg:flex ${open ? "rounded-[30px] px-3" : "items-center rounded-[40px] px-[15px]"}`}
        aria-label="Hauptnavigation"
      >
        <Link href="/app" aria-label="Postfino" className={`rail-logo grid h-12 shrink-0 place-items-center rounded-[14px] transition-transform hover:scale-[1.04] ${open ? "w-full" : "w-[42px]"}`}>
          {open ? <Logo size={30} /> : <Logo size={22} compact />}
        </Link>

        {/* new */}
        <div className="relative mt-4" data-rail-menu>
          <motion.button
            whileHover={{ scale: open ? 1.03 : 1.1 }}
            whileTap={{ scale: 0.92 }}
            transition={DOCK}
            onClick={() => setMenu((m) => (m === "new" ? null : "new"))}
            aria-expanded={menu === "new"}
            aria-haspopup="menu"
            aria-label={labels.shortcutNew}
            title={labels.shortcutNew}
            className={`flex h-[42px] items-center gap-2.5 rounded-[14px] bg-white text-[#0e0f12] shadow-[0_6px_18px_-6px_rgba(255,255,255,0.5)] ${open ? "w-full px-3" : "w-[42px] justify-center"}`}
          >
            <motion.span animate={{ rotate: menu === "new" ? 45 : 0 }} transition={DOCK} className="grid shrink-0 place-items-center">
              <Plus className="size-5" strokeWidth={2.6} />
            </motion.span>
            {open && (
              <span className="flex flex-1 items-center justify-between text-sm font-semibold whitespace-nowrap">
                {labels.new}
                <kbd className="rounded-md bg-[#0e0f12]/10 px-1.5 py-0.5 font-sans text-[0.66rem]">N</kbd>
              </span>
            )}
          </motion.button>
          <AnimatePresence>
            {menu === "new" && (
              <motion.ul role="menu" {...pop} className={`absolute top-0 z-50 w-[250px] origin-top-left rounded-[18px] bg-surface p-1.5 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)] ring-1 ring-line ${open ? "left-[calc(100%+24px)]" : "left-[60px]"}`}>
                {NEW.map((m, i) => (
                  <motion.li key={m.href} role="none" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.035 * i }}>
                    <Link role="menuitem" href={m.href} className="flex min-h-[44px] items-center gap-3 rounded-[12px] px-3 text-sm font-medium hover:bg-surface-2">
                      <span className="grid size-8 place-items-center rounded-[10px] bg-takt-soft text-takt">
                        <m.icon className="size-4" aria-hidden />
                      </span>
                      {m.label}
                    </Link>
                  </motion.li>
                ))}
                <li role="none" className="mt-1 border-t border-line pt-1">
                  <button role="menuitem" onClick={() => (setMenu(null), setConnectOpen(true))} className="flex min-h-[44px] w-full items-center gap-3 rounded-[12px] px-3 text-left text-sm font-medium hover:bg-surface-2">
                    <span className="grid size-8 place-items-center rounded-[10px] bg-surface-2 text-ink-2">
                      <Plug className="size-4" aria-hidden />
                    </span>
                    {labels.connectNewChannel}
                  </button>
                </li>
                <li role="none">
                  <Link role="menuitem" href="/app/team?invite=1" className="flex min-h-[44px] items-center gap-3 rounded-[12px] px-3 text-sm font-medium hover:bg-surface-2">
                    <span className="grid size-8 place-items-center rounded-[10px] bg-surface-2 text-ink-2">
                      <UsersRound className="size-4" aria-hidden />
                    </span>
                    {labels.inviteMember}
                  </Link>
                </li>
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        <nav className={`mt-5 flex min-h-0 flex-1 flex-col ${open ? "-mx-1 overflow-y-auto px-1 [scrollbar-width:none]" : "items-center"}`} onMouseLeave={() => setDock(null)}>
          {open && <p className="px-3 pb-1.5 text-[0.62rem] font-semibold tracking-[0.16em] text-white/40 uppercase">{labels.sectionMain}</p>}
          <ul className={`flex flex-col gap-2 ${open ? "" : "items-center"}`}>{MAIN.map((it, i) => entry(it, i))}</ul>
          {open ? <p className="mt-5 px-3 pb-1.5 text-[0.62rem] font-semibold tracking-[0.16em] text-white/40 uppercase">{labels.sectionTools}</p> : <span className="my-3 h-px w-6 bg-white/15" aria-hidden />}
          <ul className={`flex flex-col gap-2 ${open ? "" : "items-center"}`}>{TOOLS.map((it, i) => entry(it, i + MAIN.length + 1))}</ul>

          {open ? <p className="mt-5 px-3 pb-1.5 text-[0.62rem] font-semibold tracking-[0.16em] text-white/40 uppercase">{labels.channels} · {channels.length}</p> : <span className="my-3 h-px w-6 bg-white/15" aria-hidden />}
          <ul className={`flex flex-col gap-1.5 ${open ? "" : "items-center"}`}>
            {channels.slice(0, 4).map((c) => {
              const active = path.startsWith(`/app/channels/${c.id}`);
              return (
                <li key={c.id}>
                  <Link href={`/app/channels/${c.id}/queue`} aria-current={active ? "page" : undefined} aria-label={c.name} title={c.name} className={`flex items-center rounded-[14px] transition-colors ${open ? "h-10 gap-3 px-2" : "size-[42px] justify-center"} ${active ? "bg-white/15" : "hover:bg-white/10"}`}>
                    <span className="relative shrink-0">
                      <ChannelAvatar name={c.name} avatarUrl={c.avatarUrl} platform={c.platform} size={28} />
                      <span className={`absolute -top-0.5 -left-0.5 size-2.5 rounded-full ring-2 ring-[#16181f] ${c.needsReauth ? "bg-[#ff3b71]" : "bg-[#22c55e]"}`} aria-hidden />
                    </span>
                    {open && <span className="min-w-0 flex-1 truncate text-sm text-white/80">{c.name}</span>}
                    {open && <span className="text-xs tabular-nums text-white/40">{c.scheduled}</span>}
                  </Link>
                </li>
              );
            })}
            <li>
              <button onClick={() => setConnectOpen(true)} aria-label={labels.connectChannel} title={labels.connectChannel} className={`group flex items-center gap-3 rounded-[14px] border border-dashed border-white/25 text-white/60 transition-colors hover:border-white/60 hover:text-white ${open ? "h-10 w-full px-3 text-sm" : "size-[42px] justify-center"}`}>
                <Plus className="size-4 shrink-0 transition-transform duration-300 group-hover:rotate-90" />
                {open && <span className="truncate">{labels.connectChannel}</span>}
              </button>
            </li>
          </ul>
        </nav>

        {/* bottom: open/close + account */}
        <div className={`mt-4 flex gap-2 ${open ? "flex-col" : "flex-col items-center"}`}>
          <button onClick={toggle} aria-label={open ? labels.collapse : labels.expand} aria-expanded={open} title={`${open ? labels.collapse : labels.expand} ( [ )`} className={`flex items-center gap-3 rounded-[14px] text-white/60 transition-colors hover:bg-white/10 hover:text-white ${open ? "h-10 px-3 text-sm" : "size-[42px] justify-center"}`}>
            {open ? <PanelLeftClose className="size-[18px] shrink-0" /> : <PanelLeftOpen className="size-[18px] shrink-0" />}
            {open && <span className="truncate">{labels.collapse}</span>}
          </button>

          <div className="relative" data-rail-menu>
            <button
              onClick={() => setMenu((m) => (m === "account" ? null : "account"))}
              aria-expanded={menu === "account"}
              aria-haspopup="menu"
              aria-label={labels.account}
              title={`${org.userName} · ${org.planCode}`}
              className={`flex w-full items-center gap-2.5 rounded-[16px] text-left transition-colors ${open ? "bg-white/[0.07] p-2 hover:bg-white/[0.12]" : ""}`}
            >
              <span className="grid size-[42px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-takt to-[#00307a] font-display text-xs font-bold text-white ring-2 ring-white/25">{initials(org.userName)}</span>
              {open && (
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-white">{org.userName}</span>
                  <span className="block truncate text-[0.66rem] font-bold tracking-wide text-white/45 uppercase">{org.planCode}</span>
                </span>
              )}
            </button>
            <AnimatePresence>
              {menu === "account" && (
                <motion.div role="menu" {...pop} className={`absolute bottom-0 z-50 max-h-[80vh] w-[290px] origin-bottom-left overflow-y-auto rounded-[20px] bg-surface p-2 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)] ring-1 ring-line ${open ? "left-[calc(100%+24px)]" : "left-[60px]"}`}>
                  <div className="flex items-center gap-3 rounded-[14px] bg-surface-2 p-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-gradient-to-br from-takt to-[#00307a] font-display text-sm font-bold text-white">{initials(org.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{org.name}</span>
                      <span className="block truncate text-xs text-ink-3">{org.userEmail}</span>
                    </span>
                    <span className="rounded-full bg-takt-soft px-2 py-0.5 text-[0.62rem] font-bold uppercase text-takt">{org.planCode}</span>
                  </div>
                  {workspaceSwitcher && <div className="mt-2">{workspaceSwitcher}</div>}
                  <div className="mt-2 rounded-[14px] p-3 ring-1 ring-line">
                    <p className="flex items-center justify-between">
                      <span className="eyebrow">{labels.usage}</span>
                      {org.planCode !== "enterprise" && (
                        <Link href="/app/billing" className="inline-flex items-center gap-1 rounded-full bg-takt px-2 py-0.5 text-[0.68rem] font-bold text-takt-ink">
                          <Sparkles className="size-3" aria-hidden /> {labels.upgrade}
                        </Link>
                      )}
                    </p>
                    {(
                      [
                        [labels.usageChannels, usage.channels],
                        [labels.usageMembers, usage.members],
                      ] as const
                    ).map(([label, u]) => (
                      <div key={label} className="mt-2">
                        <p className="mb-1 flex justify-between text-xs">
                          <span className="text-ink-2">{label}</span>
                          <span className="font-semibold tabular-nums">
                            {u.used}
                            <span className="font-normal text-ink-3"> / {u.limit ?? labels.unlimited}</span>
                          </span>
                        </p>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={label} aria-valuenow={u.used} aria-valuemin={0} aria-valuemax={u.limit ?? undefined}>
                          <motion.div initial={{ width: 0 }} animate={{ width: `${u.limit ? Math.max(4, pct(u)) : 8}%` }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} className={`h-full rounded-full ${pct(u) >= 90 ? "bg-bad" : "bg-takt"}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <ul className="mt-1">
                    {ORG.map((it) => (
                      <li key={it.href} role="none">
                        <Link role="menuitem" href={it.href} className="flex min-h-[38px] items-center gap-3 rounded-[10px] px-3 text-sm hover:bg-surface-2">
                          <it.icon className="size-4 text-ink-3" aria-hidden /> {labels[it.key]}
                        </Link>
                      </li>
                    ))}
                    <li role="none" className="mt-1 border-t border-line pt-1">
                      <form action={logoutAction}>
                        <button role="menuitem" className="flex min-h-[38px] w-full items-center gap-3 rounded-[10px] px-3 text-sm text-bad hover:bg-bad-soft">
                          <LogOut className="size-4" aria-hidden /> {labels.logout}
                        </button>
                      </form>
                    </li>
                  </ul>
                  <div className="mt-2 flex justify-center border-t border-line pt-3 pb-1">
                    <MadeBy pre={labels.madeByPre} suf={labels.madeBySuf} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.aside>

      {/* ── phones: bottom tab bar + "more" sheet ── */}
      <nav className="glass-rail fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-[26px] px-2 py-2 lg:hidden" aria-label="Hauptnavigation">
        {[MAIN[0]!, MAIN[2]!].map((it) => (
          <Link key={it.href} href={it.href} aria-label={labels[it.key]} aria-current={isActive(it.href) ? "page" : undefined} className={`grid size-12 place-items-center rounded-full ${isActive(it.href) ? "bg-takt text-white" : "text-white/70"}`}>
            <it.icon className="size-5" />
          </Link>
        ))}
        <Link href="/app/compose/post" aria-label={labels.composePost} className="grid size-12 place-items-center rounded-full bg-white text-[#0e0f12]">
          <Plus className="size-5" strokeWidth={2.6} />
        </Link>
        <Link href={MAIN[3]!.href} aria-label={labels.community} aria-current={isActive(MAIN[3]!.href) ? "page" : undefined} className={`grid size-12 place-items-center rounded-full ${isActive(MAIN[3]!.href) ? "bg-takt text-white" : "text-white/70"}`}>
          <MessagesSquare className="size-5" />
        </Link>
        <button onClick={() => setSheet(true)} aria-label={labels.more} aria-expanded={sheet} className="grid size-12 place-items-center rounded-full text-white/70">
          <LayoutGrid className="size-5" />
        </button>
      </nav>
      <AnimatePresence>
        {sheet && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setSheet(false)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 32 }} className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-[28px] bg-surface p-4 pb-8">
              <div className="mb-3 flex items-center justify-between">
                <Logo size={30} />
                <button onClick={() => setSheet(false)} className="grid size-10 place-items-center rounded-full bg-surface-2" aria-label={labels.close}>
                  <X className="size-5" />
                </button>
              </div>
              <ul className="grid grid-cols-3 gap-2">
                {[...MAIN, ...TOOLS, ...ORG].map((it) => (
                  <li key={it.href}>
                    <Link href={it.href} className={`flex flex-col items-center gap-1.5 rounded-[16px] p-3 text-center text-xs font-medium ${isActive(it.href) ? "bg-takt-soft text-takt" : "bg-surface-2"}`}>
                      <it.icon className="size-5" aria-hidden />
                      {labels[it.key]}
                    </Link>
                  </li>
                ))}
              </ul>
              <form action={logoutAction} className="mt-4">
                <button className="btn btn-ghost w-full justify-center text-bad">
                  <LogOut className="size-4" /> {labels.logout}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
