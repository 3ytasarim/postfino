"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/** Workspace-time clock pill + date (the time zone posts are scheduled in). Minute digits roll on change. */
export function LiveClock({ tz, locale }: { tz: string; locale: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  if (!now) return <span className="hidden h-10 w-[150px] md:block" aria-hidden />;
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(now);
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", weekday: "short", timeZone: tz }).format(now);
  return (
    <span className="hidden items-center gap-2 md:flex" title={tz}>
      <span className="relative h-10 overflow-hidden rounded-full bg-surface px-4 font-display text-sm leading-10 font-bold tabular-nums ring-1 ring-line">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={time} className="block" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -18, opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}>
            {time}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="hidden flex-col text-right leading-tight lg:flex">
        <span className="text-[0.68rem] text-ink-3">{tz.split("/").pop()?.replace(/_/g, " ")}</span>
        <span className="text-xs font-semibold">{date}</span>
      </span>
    </span>
  );
}
