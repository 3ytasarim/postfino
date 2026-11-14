"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

export type CapsuleDay = { key: string; weekday: string; label: string; value: number; future: boolean; today: boolean };

const EASE = [0.16, 1, 0.3, 1] as const;
const H = 190; // stage height (px)
const CAP = 22; // capsule height
const GAP = 6;
const MAXCAPS = 6;

function curve(pts: [number, number][]) {
  if (!pts[0]) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  return d;
}

/**
 * Two weeks as capsule columns: last 7 days (published, cobalt) and the next 7 (scheduled, lilac). Each column stacks
 * capsules up to the day's count; the top capsule carries the number. Spline curves run through the column tops and
 * draw in; a floating widget switches which series is in focus. Hover/focus a column for its exact value.
 */
export function CapsuleChart({ days, labels }: { days: CapsuleDay[]; labels: { title: string; sub: string; published: string; scheduled: string; today: string; posts: string; focus: string } }) {
  const [focus, setFocus] = useState<"published" | "scheduled">("published");
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.value));
  const unit = Math.max(1, Math.ceil(max / MAXCAPS));
  const caps = (v: number) => (v === 0 ? 0 : Math.min(MAXCAPS, Math.ceil(v / unit)));
  const n = days.length;
  const VW = 1400;
  const x = (i: number) => ((i + 0.5) / n) * VW;
  const y = (v: number) => (caps(v) === 0 ? H - 6 : H - caps(v) * (CAP + GAP) + GAP + CAP / 2 - 4);
  const pastIdx = days.map((d, i) => (!d.future ? i : -1)).filter((i) => i >= 0);
  const futIdx = days.map((d, i) => (d.future || d.today ? i : -1)).filter((i) => i >= 0);
  const pastPath = curve(pastIdx.map((i) => [x(i), y(days[i]!.value)]));
  const futPath = curve(futIdx.map((i) => [x(i), y(days[i]!.today ? days[i]!.value : days[i]!.value)]));

  return (
    <div className="relative">
      {/* floating focus widget */}
      <motion.div
        className="absolute top-0 right-0 z-10 w-[196px] rounded-[18px] bg-surface p-3 shadow-[0_18px_40px_-18px_rgb(0_0_0/0.35)] ring-1 ring-line"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: [0, -5, 0] }}
        transition={{ opacity: { duration: 0.5, delay: 0.9 }, y: { repeat: Infinity, duration: 4.5, ease: "easeInOut", delay: 1 } }}
      >
        <p className="flex items-center justify-between text-xs font-bold">
        {labels.focus} <span className="text-ink-3">⠿</span>
      </p>
        <div className="relative mt-2 grid grid-cols-2 rounded-full bg-surface-2 p-0.5" role="tablist">
          {(["published", "scheduled"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={focus === k} onClick={() => setFocus(k)} className={`relative z-[1] rounded-full px-2 py-1 text-[0.68rem] font-semibold transition-colors ${focus === k ? "text-white" : "text-ink-2"}`}>
              {focus === k && <motion.span layoutId="cap-focus" className={`absolute inset-0 -z-[1] rounded-full ${k === "published" ? "bg-takt" : "bg-[var(--lilac)]"}`} transition={{ type: "spring", stiffness: 420, damping: 32 }} />}
              {k === "published" ? labels.published : labels.scheduled}
            </button>
          ))}
        </div>
      </motion.div>
      <div className="mb-5 flex min-h-[64px] items-start gap-2.5 pr-[210px]">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-bg" aria-hidden>
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 18V9M10 18V5M16 18v-7M22 18H2" /></svg>
        </span>
        <div>
          <h2 className="font-display text-[1.05rem] font-bold leading-tight tracking-tight">{labels.title}</h2>
          <p className="mt-0.5 text-xs text-ink-3">{labels.sub}</p>
        </div>
      </div>
      <div className="grid text-center text-[0.72rem] font-medium text-ink-3" style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))` }}>
        {days.map((d) => (
          <span key={d.key} className={d.today ? "font-bold text-ink" : ""}>
            {d.weekday}
          </span>
        ))}
      </div>

      <div className="relative mt-3" style={{ height: H }}>
        <svg className="pointer-events-none absolute inset-0 z-[1] h-full w-full overflow-visible" viewBox={`0 0 ${VW} ${H}`} preserveAspectRatio="none" aria-hidden>
          <motion.path d={pastPath} fill="none" stroke="var(--takt)" strokeWidth="3.8" strokeLinecap="round" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1, opacity: focus === "published" ? 1 : 0.25 }} transition={{ pathLength: { duration: 1.4, ease: EASE, delay: 0.5 }, opacity: { duration: 0.3 } }} />
          <motion.path d={futPath} fill="none" stroke="var(--lilac)" strokeWidth="3.8" strokeLinecap="round" strokeDasharray="0.1 0" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1, opacity: focus === "scheduled" ? 1 : 0.3 }} transition={{ pathLength: { duration: 1.2, ease: EASE, delay: 1.1 }, opacity: { duration: 0.3 } }} />
        </svg>

        <div className="absolute inset-0 grid items-end" style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))` }} role="img" aria-label={`${labels.title}: ${days.map((d) => `${d.label} ${d.value}`).join(", ")}`}>
          {days.map((d, i) => {
            const c = caps(d.value);
            const dim = (focus === "published" && d.future) || (focus === "scheduled" && !d.future && !d.today);
            return (
              <div
                key={d.key}
                className="relative flex h-full cursor-default flex-col items-center justify-end gap-[6px] outline-none"
                tabIndex={0}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                style={{ opacity: dim ? 0.45 : 1, transition: "opacity 300ms" }}
              >
                {d.today && <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 border-l border-dashed border-ink-3/50" aria-hidden />}
                {c === 0 ? (
                  <motion.span initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: 0.2 + i * 0.03 }} className="h-[22px] w-[min(46px,80%)] origin-bottom rounded-full border border-dashed border-ink-3/40" />
                ) : (
                  Array.from({ length: c }, (_, k) => {
                    const top = k === 0;
                    return (
                      <motion.span
                        key={k}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 420, damping: 22, delay: 0.15 + i * 0.04 + (c - k) * 0.05 }}
                        className={`grid h-[22px] w-[min(46px,80%)] place-items-center rounded-full text-[0.68rem] font-bold tabular-nums ${top ? (d.future ? "bg-[var(--lilac)] text-white" : "bg-ink text-bg") : "bg-surface ring-1 ring-line"}`}
                      >
                        {top ? d.value : ""}
                      </motion.span>
                    );
                  })
                )}
                <AnimatePresence>
                  {hover === i && (
                    <motion.span initial={{ opacity: 0, y: 6, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }} className="absolute bottom-full z-20 mb-2 whitespace-nowrap rounded-[12px] bg-ink px-2.5 py-1.5 text-center text-[0.7rem] text-bg shadow-lg">
                      <span className="block font-semibold">{d.label}</span>
                      {labels.posts.replace("{n}", String(d.value))} · {d.future ? labels.scheduled : labels.published}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
