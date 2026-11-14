"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus, Play } from "lucide-react";
import { NetworkIcon } from "../network-icon";

export type PanelPost = { id: string; caption: string; at: string; platform: string | null; thumb: { assetId: string; kind: "image" | "video" } | null };
export type PanelData = {
  org: { name: string; workspace: string; initials: string };
  stats: { channels: number; scheduled: number; drafts: number };
  scheduledDays: string[]; // YYYY-MM-DD in workspace time zone
  publishedDays: string[];
  today: string;
  next: PanelPost[];
  locale: string;
  tz: string;
};
export type PanelLabels = { channels: string; scheduled: string; drafts: string; upcoming: string; all: string; empty: string; plan: string; legendScheduled: string; legendPublished: string; settings: string };

const EASE = [0.16, 1, 0.3, 1] as const;
const ymd = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Right-hand glass panel of the dashboard (only on /app): organisation header, three counters, a month calendar
 * marking scheduled (cobalt) and published (green) days with today ringed, and the next scheduled posts.
 */
export function RightPanel({ data, l }: { data: PanelData; l: PanelLabels }) {
  const path = usePathname();
  const [ty, tm] = data.today.split("-").map(Number) as [number, number];
  const [cursor, setCursor] = useState({ y: ty, m: tm - 1 });
  const [dir, setDir] = useState(1);
  const sched = useMemo(() => new Set(data.scheduledDays), [data.scheduledDays]);
  const pub = useMemo(() => new Set(data.publishedDays), [data.publishedDays]);
  if (path !== "/app") return null;

  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const monthLabel = new Intl.DateTimeFormat(data.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  const wd = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(data.locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i))).slice(0, 2));
  const time = new Intl.DateTimeFormat(data.locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: data.tz });
  const move = (d: number) => {
    setDir(d);
    setCursor((c) => {
      const m = c.m + d;
      return { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  };

  return (
    <motion.aside initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, ease: EASE, delay: 0.1 }} className="glass hidden w-[300px] shrink-0 flex-col gap-4 overflow-y-auto rounded-[32px] p-5 [scrollbar-width:none] xl:flex" aria-label={l.upcoming}>
      {/* org */}
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-takt to-[#00307a] font-display text-sm font-bold text-white ring-2 ring-white/40">{data.org.initials}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{data.org.name}</span>
          <span className="block truncate text-xs text-ink-3">@{data.org.workspace}</span>
        </span>
        <Link href="/app/settings" className="grid size-9 place-items-center rounded-full bg-surface/60 text-ink-2 ring-1 ring-line transition-colors hover:text-ink" aria-label={l.settings}>
          <MoreHorizontal className="size-4" />
        </Link>
      </div>

      {/* counters */}
      <div className="grid grid-cols-3 divide-x divide-line rounded-[18px] bg-surface/50 py-3 text-center ring-1 ring-line">
        {[
          [data.stats.channels, l.channels, "/app/channels"],
          [data.stats.scheduled, l.scheduled, "/app/publish"],
          [data.stats.drafts, l.drafts, "/app/publish?tab=drafts"],
        ].map(([v, k, href]) => (
          <Link key={k as string} href={href as string} className="group px-1">
            <span className="block font-display text-xl font-bold tabular-nums transition-transform group-hover:-translate-y-0.5">{v}</span>
            <span className="block text-[0.68rem] text-ink-3">{k}</span>
          </Link>
        ))}
      </div>

      {/* calendar */}
      <div className="rounded-[20px] bg-surface/50 p-3.5 ring-1 ring-line">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-bold capitalize">{monthLabel}</span>
          <span className="flex gap-1">
            <button onClick={() => move(-1)} className="grid size-7 place-items-center rounded-full bg-surface ring-1 ring-line hover:bg-surface-2" aria-label="‹">
              <ChevronLeft className="size-3.5" />
            </button>
            <button onClick={() => move(1)} className="grid size-7 place-items-center rounded-full bg-surface ring-1 ring-line hover:bg-surface-2" aria-label="›">
              <ChevronRight className="size-3.5" />
            </button>
          </span>
        </div>
        <div className="grid grid-cols-7 text-center text-[0.62rem] font-semibold text-ink-3">
          {wd.map((d) => (
            <span key={d} className="py-1">
              {d}
            </span>
          ))}
        </div>
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div key={`${cursor.y}-${cursor.m}`} initial={{ opacity: 0, x: 18 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -18 * dir }} transition={{ duration: 0.22, ease: EASE }} className="grid grid-cols-7 gap-y-1 text-center text-xs">
            {cells.map((d, i) => {
              if (d === null) return <span key={`x${i}`} />;
              const key = ymd(cursor.y, cursor.m, d);
              const isToday = key === data.today;
              const s = sched.has(key);
              const p = pub.has(key);
              return (
                <Link
                  key={key}
                  href={`/app/calendar?d=${key}`}
                  title={key}
                  className={`mx-auto grid size-8 place-items-center rounded-full tabular-nums transition-transform hover:scale-110 ${s ? "bg-takt font-bold text-white shadow-[0_4px_10px_-3px_var(--takt)]" : p ? "bg-[#22c55e] font-bold text-white" : "text-ink-2 hover:bg-surface"} ${isToday ? "ring-2 ring-takt ring-offset-2 ring-offset-transparent" : ""}`}
                >
                  {d}
                </Link>
              );
            })}
          </motion.div>
        </AnimatePresence>
        <p className="mt-2 flex items-center justify-center gap-3 text-[0.65rem] text-ink-3">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-takt" /> {l.legendScheduled}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-[#22c55e]" /> {l.legendPublished}
          </span>
        </p>
      </div>

      {/* next posts */}
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-bold">
            <span className="h-4 w-1 rounded-full bg-takt" /> {l.upcoming}
          </span>
          <Link href="/app/publish" className="text-xs font-semibold text-ink-2 hover:text-ink">
            {l.all}
          </Link>
        </p>
        {data.next.length === 0 ? (
          <Link href="/app/compose/post" className="group grid place-items-center gap-2 rounded-[18px] border border-dashed border-line px-4 py-6 text-center text-xs text-ink-3 transition-colors hover:border-takt hover:text-takt">
            <span className="grid size-9 place-items-center rounded-full bg-surface ring-1 ring-line transition-transform group-hover:rotate-90">
              <Plus className="size-4" />
            </span>
            {l.empty}
          </Link>
        ) : (
          <ul className="space-y-2">
            {data.next.map((p, i) => (
              <motion.li key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.07, ease: EASE }}>
                <Link href={`/app/posts/${p.id}`} className="flex items-center gap-3 rounded-[16px] bg-surface/60 p-2 ring-1 ring-line transition-transform hover:-translate-y-0.5">
                  <span className="relative size-11 shrink-0 overflow-hidden rounded-[12px] bg-surface-2">
                    {p.thumb ? (
                      p.thumb.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/app/api/media/${p.thumb.assetId}`} alt="" className="size-full object-cover" />
                      ) : (
                        <>
                          <video src={`/app/api/media/${p.thumb.assetId}#t=0.5`} muted preload="metadata" className="size-full object-cover" aria-hidden />
                          <Play className="absolute inset-0 m-auto size-4 fill-white text-white" />
                        </>
                      )
                    ) : p.platform ? (
                      <span className="grid size-full place-items-center">
                        <NetworkIcon platform={p.platform} badge size={26} />
                      </span>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {p.platform && <NetworkIcon platform={p.platform} badge size={14} />}
                      <span className="truncate text-[0.7rem] font-semibold text-ink-3">{time.format(new Date(p.at))}</span>
                    </span>
                    <span className="block truncate text-sm font-medium">{p.caption || "—"}</span>
                  </span>
                </Link>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </motion.aside>
  );
}
