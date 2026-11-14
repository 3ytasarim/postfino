"use client";
import Link from "next/link";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Clapperboard, Images, Plus, X } from "lucide-react";
import { wallClockToUtc, NonexistentLocalTimeError } from "@sichttakt/shared";
import { reschedulePostAction } from "@/app/app/actions";
import { NetworkIcon } from "../network-icon";

/** One card per channel target (as in the reference: the same post on IG and TikTok shows twice). */
export type PubCard = {
  key: string;
  postId: string;
  day: string; // YYYY-MM-DD in the display time zone
  hour: number;
  minute: number;
  time: string; // localized
  caption: string;
  platform: string | null;
  type: string;
  status: string;
  statusLabel: string;
  thumb: { assetId: string; kind: "image" | "video" } | null;
  movable: boolean;
};
export type CalLabels = { today: string; noDate: string; noDateEmpty: string; plan: string; dragHint: string; close: string };

const EASE = [0.16, 1, 0.3, 1] as const;
const pad = (n: number) => String(n).padStart(2, "0");
const tone: Record<string, string> = {
  PENDING_APPROVAL: "ring-puls/40",
  CHANGES_REQUESTED: "ring-warn/50",
  FAILED_FINAL: "ring-bad/50",
  FAILED_RETRYABLE: "ring-bad/50",
  PUBLISHED: "ring-ok/40",
  DRAFT: "ring-line border-dashed",
};

function Thumb({ t }: { t: PubCard["thumb"] }) {
  if (!t) return null;
  const src = `/app/api/media/${t.assetId}`;
  return (
    <span className="relative size-11 shrink-0 overflow-hidden rounded-[8px] bg-surface-2">
      {t.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <>
          <video src={`${src}#t=0.5`} muted playsInline preload="metadata" className="size-full object-cover" aria-hidden />
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid size-5 place-items-center rounded-full bg-black/55 text-white">
              <svg viewBox="0 0 24 24" className="size-2.5 fill-current" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        </>
      )}
    </span>
  );
}

export function PublishCalendar({
  mode,
  days,
  today,
  nowHour,
  month,
  timezone,
  locale,
  cards,
  undated,
  showUndated,
  l,
}: {
  mode: "week" | "month";
  days: string[];
  today: string;
  nowHour: number;
  month: string;
  timezone: string;
  locale: string;
  cards: PubCard[];
  undated: { id: string; caption: string; type: string; platform: string | null }[];
  showUndated: boolean;
  l: CalLabels;
}) {
  const [items, move] = useOptimistic(cards, (cur, m: { postId: string; day: string; hour: number }) => cur.map((c) => (c.postId === m.postId ? { ...c, day: m.day, hour: m.hour } : c)));
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [panel, setPanel] = useState(showUndated);
  const dragging = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const head = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  const headShort = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const hourFmt = new Intl.DateTimeFormat(locale, { hour: "numeric", timeZone: "UTC" });
  const dateOf = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d!));
  };

  // open the week around the first busy hour (or ~1 h before now), like a planner would
  useEffect(() => {
    if (mode !== "week" || !scroller.current) return;
    const first = items.length ? Math.min(...items.map((c) => c.hour)) : nowHour;
    scroller.current.scrollTop = Math.max(0, Math.min(first, nowHour) - 1) * 112;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function drop(day: string, hour: number | null) {
    const id = dragging.current;
    dragging.current = null;
    setOver(null);
    const c = items.find((x) => x.postId === id);
    if (!c || !c.movable) return;
    const h = hour ?? c.hour;
    if (c.day === day && c.hour === h) return;
    const [y, m, d] = day.split("-").map(Number);
    let iso: string;
    try {
      iso = wallClockToUtc({ year: y!, month: m!, day: d!, hour: h, minute: c.minute }, timezone).toISOString();
    } catch (e) {
      setError(e instanceof NonexistentLocalTimeError ? e.message : String(e));
      return;
    }
    startTransition(async () => {
      move({ postId: c.postId, day, hour: h });
      const r = await reschedulePostAction(c.postId, iso);
      setError(r?.error ?? null);
    });
  }

  const card = (c: PubCard, compact = false) => (
    <motion.div key={c.key} layout layoutId={c.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
      <Link
        href={`/app/posts/${c.postId}`}
        draggable={c.movable}
        onDragStart={(e) => {
          dragging.current = c.postId;
          e.dataTransfer.setData("text/plain", c.postId);
          e.dataTransfer.effectAllowed = "move";
        }}
        title={`${c.time} · ${c.statusLabel}`}
        className={`group flex gap-2 rounded-[12px] bg-surface p-2 shadow-[0_1px_2px_rgb(0_0_0/0.06)] ring-1 transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-10px_rgb(0_0_0/0.3)] ${tone[c.status] ?? "ring-line"} ${c.movable ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[0.72rem] font-semibold tabular-nums">
            {c.platform && <NetworkIcon platform={c.platform} badge size={16} />}
            {c.time}
            {c.type === "reel" && <Clapperboard className="ml-auto size-3.5 text-ink-3" aria-label="Reel" />}
            {c.type === "carousel" && <Images className="ml-auto size-3.5 text-ink-3" aria-label="Carousel" />}
          </span>
          {!compact && <span className="mt-1 line-clamp-2 block text-[0.78rem] leading-snug text-ink-2">{c.caption || "—"}</span>}
        </span>
        {!compact && <Thumb t={c.thumb} />}
      </Link>
    </motion.div>
  );

  const dropZone = (id: string, day: string, hour: number | null) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (over !== id) setOver(id);
    },
    onDragLeave: () => over === id && setOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dragging.current = dragging.current ?? e.dataTransfer.getData("text/plain");
      drop(day, hour);
    },
  });

  return (
    <div className="flex gap-3">
      <div className="min-w-0 flex-1 overflow-hidden rounded-[18px] bg-surface ring-1 ring-line">
        {error && (
          <p role="alert" className="border-b border-line bg-bad-soft px-4 py-2 text-sm font-medium text-bad">
            {error}
          </p>
        )}

        {mode === "week" ? (
          <>
            <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-line">
              <span />
              {days.map((k) => {
                const isToday = k === today;
                return (
                  <div key={k} className={`relative py-3 text-center text-sm ${isToday ? "font-semibold text-takt" : "text-ink-2"}`}>
                    <span className="hidden xl:inline">{head.format(dateOf(k))}</span>
                    <span className="xl:hidden">{headShort.format(dateOf(k))}</span> <span className="tabular-nums">{dateOf(k).getUTCDate()}</span>
                    {isToday && <motion.span layoutId="today-bar" className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-takt" />}
                  </div>
                );
              })}
            </div>
            <div ref={scroller} className="max-h-[calc(100dvh-300px)] min-h-[420px] overflow-y-auto [scrollbar-width:thin]">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="grid min-h-[112px] grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-line last:border-b-0">
                  <span className="relative -top-2 pr-2 text-right text-[0.68rem] text-ink-3">{h === 0 ? "" : hourFmt.format(new Date(Date.UTC(2024, 0, 1, h)))}</span>
                  {days.map((k) => {
                    const id = `${k}-${h}`;
                    const past = k < today || (k === today && h < nowHour);
                    const here = items.filter((c) => c.day === k && c.hour === h).sort((a, b) => a.minute - b.minute);
                    return (
                      <div key={id} {...dropZone(id, k, h)} className={`group/cell relative space-y-1.5 border-l border-line p-1.5 transition-colors ${past ? "bg-surface-2/60" : ""} ${over === id ? "bg-takt-soft" : ""}`}>
                        <AnimatePresence initial={false}>{here.map((c) => card(c))}</AnimatePresence>
                        {!past && here.length === 0 && (
                          <Link
                            href={`/app/compose/post?at=${encodeURIComponent(`${k}T${pad(h)}:00`)}`}
                            className="absolute inset-1.5 hidden place-items-center rounded-[10px] border border-dashed border-takt/40 text-xs font-semibold text-takt group-hover/cell:grid"
                            aria-label={`${l.plan} ${k} ${pad(h)}:00`}
                          >
                            <span className="flex items-center gap-1">
                              <Plus className="size-3.5" /> {l.plan}
                            </span>
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-7 border-b border-line">
              {days.slice(0, 7).map((k) => (
                <div key={k} className="py-2.5 text-center text-xs font-semibold tracking-wide text-ink-3 uppercase">
                  {headShort.format(dateOf(k))}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((k) => {
                const inMonth = k.slice(0, 7) === month;
                const here = items.filter((c) => c.day === k).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
                return (
                  <div key={k} {...dropZone(k, k, null)} className={`min-h-[132px] space-y-1 border-b border-l border-line p-1.5 transition-colors first:border-l-0 [&:nth-child(7n+1)]:border-l-0 ${inMonth ? "" : "bg-surface-2/50"} ${over === k ? "bg-takt-soft" : ""}`}>
                    <p className={`mb-1 flex items-center justify-between px-1 text-xs tabular-nums ${k === today ? "font-bold text-takt" : inMonth ? "text-ink-2" : "text-ink-3"}`}>
                      <span className={k === today ? "grid size-6 place-items-center rounded-full bg-takt text-takt-ink" : ""}>{dateOf(k).getUTCDate()}</span>
                    </p>
                    {here.slice(0, 3).map((c) => card(c, true))}
                    {here.length > 3 && <p className="px-1 text-[0.7rem] font-semibold text-ink-3">+{here.length - 3}</p>}
                  </div>
                );
              })}
            </div>
          </>
        )}
        <p className="border-t border-line px-4 py-2 text-[0.7rem] text-ink-3">{l.dragHint}</p>
      </div>

      {/* undated posts drawer ("No Date") */}
      <AnimatePresence>
        {panel && (
          <motion.aside initial={{ opacity: 0, x: 16, width: 0 }} animate={{ opacity: 1, x: 0, width: 280 }} exit={{ opacity: 0, x: 16, width: 0 }} transition={{ duration: 0.35, ease: EASE }} className="hidden shrink-0 overflow-hidden lg:block">
            <div className="w-[280px] rounded-[18px] bg-surface p-3 ring-1 ring-line">
              <p className="mb-2 flex items-center justify-between text-sm font-bold">
                {l.noDate} <span className="text-xs font-normal text-ink-3">{undated.length}</span>
                <button onClick={() => setPanel(false)} className="grid size-7 place-items-center rounded-full hover:bg-surface-2" aria-label={l.close}>
                  <X className="size-4" />
                </button>
              </p>
              {undated.length === 0 ? (
                <p className="rounded-[12px] border border-dashed border-line px-3 py-6 text-center text-xs text-ink-3">{l.noDateEmpty}</p>
              ) : (
                <ul className="space-y-1.5">
                  {undated.map((u) => (
                    <li key={u.id}>
                      <Link href={`/app/posts/${u.id}`} className="flex items-center gap-2 rounded-[12px] p-2 ring-1 ring-line hover:bg-surface-2">
                        {u.platform && <NetworkIcon platform={u.platform} badge size={18} />}
                        <span className="line-clamp-2 text-xs text-ink-2">{u.caption || "—"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
