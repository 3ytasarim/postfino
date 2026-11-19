"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { NetworkIcon, NETWORK_NAMES } from "./network-icon";
import { Logo } from "./logo";
import { useTick } from "@/lib/use-tick";

const INNER = ["instagram_business", "linkedin_page", "tiktok", "facebook_page", "youtube"];
const OUTER = ["threads", "pinterest", "x", "bluesky", "mastodon", "google_business"];
// Alternate rings so the highlight jumps around the orbit instead of walking one ring.
const ORDER = INNER.flatMap((p, i) => [p, OUTER[i]]).concat(OUTER.slice(INNER.length));
const STEP_MS = 2600;
const SEND_MS = 1100;

function Ring({ items, radius, duration, reverse = false, size, active, done }: { items: string[]; radius: number; duration: number; reverse?: boolean; size: number; active: string; done: boolean }) {
  return (
    <div className="orbit-ring absolute top-1/2 left-1/2" style={{ width: radius * 2, height: radius * 2, marginLeft: -radius, marginTop: -radius, animationDuration: `${duration}s`, animationDirection: reverse ? "reverse" : "normal" }}>
      <span className="absolute inset-0 rounded-full border border-dashed border-cobalt/20" />
      {items.map((p, i) => {
        const a = (i / items.length) * Math.PI * 2;
        const on = p === active;
        return (
          <span key={p} className="absolute" style={{ left: Math.round(radius + Math.cos(a) * radius - size / 2), top: Math.round(radius + Math.sin(a) * radius - size / 2) }}>
            <span className="orbit-ring block" style={{ width: size, height: size, animationDuration: `${duration}s`, animationDirection: reverse ? "normal" : "reverse" }}>
              <motion.span
                className="relative grid size-full place-items-center rounded-2xl bg-surface ring-1 ring-line"
                initial={false}
                animate={on ? { scale: 1.18, boxShadow: done ? "0 0 0 3px #19c39c, 0 18px 36px -10px rgba(25,195,156,0.65)" : "0 0 0 3px #4f8dff, 0 18px 36px -10px rgba(0,71,171,0.55)" } : { scale: 1, boxShadow: "0 14px 30px -12px rgba(16,40,110,0.45)" }}
                transition={{ type: "spring", stiffness: 320, damping: 22 }}
              >
                <NetworkIcon platform={p} badge size={Math.round(size * 0.62)} />
                <AnimatePresence>
                  {on && done && (
                    <motion.span initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 460, damping: 18 }} className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-mint text-white ring-2 ring-surface">
                      <Check className="size-3" strokeWidth={3.5} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Postfino hub in the middle: each beat it sends a post to one network, shows progress, then confirms it. */
export function Orbit() {
  const box = useRef<HTMLDivElement>(null);
  const t = useTick(STEP_MS, 0, box);
  const p = ORDER[t % ORDER.length];
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDone(false);
    const id = window.setTimeout(() => setDone(true), SEND_MS);
    return () => window.clearTimeout(id);
  }, [t]);

  return (
    <div ref={box} className="relative mx-auto aspect-square w-full max-w-[520px]" aria-hidden>
      <div className="absolute inset-[18%] rounded-full bg-[radial-gradient(circle,rgba(79,141,255,0.22),transparent_70%)]" />
      <div className="absolute inset-0 origin-center scale-[0.66] sm:scale-100">
        <div className="absolute top-1/2 left-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2">
          <Ring items={INNER} radius={150} duration={28} size={58} active={p} done={done} />
          <Ring items={OUTER} radius={240} duration={42} reverse size={50} active={p} done={done} />
        </div>
      </div>

      {/* hub */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        {/* a ring wave leaves the hub on every send */}
        <AnimatePresence>
          <motion.span key={t} className="absolute inset-0 rounded-[20px] border-2 border-sky sm:rounded-[26px]" initial={{ opacity: 0.7, scale: 1 }} animate={{ opacity: 0, scale: 1.7 }} exit={{ opacity: 0 }} transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }} />
        </AnimatePresence>
        <div className="relative w-[104px] overflow-hidden rounded-[20px] sm:w-[188px] sm:rounded-[26px] bg-surface shadow-[0_30px_60px_-20px_rgba(0,71,171,0.55)] ring-1 ring-line">
          <div className="grid origin-center scale-[0.72] place-items-center px-4 pt-3 pb-1.5 sm:scale-100 sm:pt-5 sm:pb-3">
            <Logo size={30} />
          </div>
          {/* live status row */}
          <div className="relative h-[38px] border-t border-line bg-paper/70 sm:h-[50px]">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={t} className="absolute inset-0 flex items-center justify-between gap-2 px-2.5 sm:justify-start sm:px-3" initial={{ y: 22, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -22, opacity: 0 }} transition={{ type: "spring", stiffness: 360, damping: 30 }}>
                <span className="shrink-0">
                  <NetworkIcon platform={p} badge size={24} />
                </span>
                <span className="hidden min-w-0 flex-1 sm:block">
                  <span className="block truncate text-[0.78rem] leading-tight font-bold">{NETWORK_NAMES[p]}</span>
                  <span className="relative block h-3.5 overflow-hidden text-[0.66rem] leading-[0.875rem] font-semibold">
                    <motion.span className="absolute inset-0 text-ink-3" initial={false} animate={{ y: done ? -14 : 0, opacity: done ? 0 : 1 }}>
                      wird gesendet…
                    </motion.span>
                    <motion.span className="absolute inset-0 text-mint" initial={false} animate={{ y: done ? 0 : 14, opacity: done ? 1 : 0 }}>
                      veröffentlicht
                    </motion.span>
                  </span>
                </span>
                <span className="relative ml-auto grid size-6 shrink-0 place-items-center sm:ml-0">
                  {/* progress ring → check */}
                  <svg viewBox="0 0 24 24" className="absolute inset-0 -rotate-90">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-line" />
                    <motion.circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-cobalt" initial={{ pathLength: 0 }} animate={{ pathLength: 1, opacity: done ? 0 : 1 }} transition={{ pathLength: { duration: SEND_MS / 1000, ease: "easeInOut" }, opacity: { duration: 0.2 } }} />
                  </svg>
                  <motion.span className="grid size-6 place-items-center rounded-full bg-mint text-white" initial={{ scale: 0 }} animate={{ scale: done ? 1 : 0 }} transition={{ type: "spring", stiffness: 480, damping: 18 }}>
                    <Check className="size-3.5" strokeWidth={3.5} />
                  </motion.span>
                </span>
              </motion.div>
            </AnimatePresence>
            {/* bottom progress bar */}
            <motion.span key={`bar-${t}`} className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-cobalt to-sky" initial={{ width: "0%", opacity: 1 }} animate={{ width: "100%", opacity: done ? 0 : 1 }} transition={{ width: { duration: SEND_MS / 1000, ease: "easeInOut" }, opacity: { duration: 0.4 } }} />
          </div>
        </div>
      </div>
    </div>
  );
}
