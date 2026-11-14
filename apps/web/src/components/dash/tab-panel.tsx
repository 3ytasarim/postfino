"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

export type DashTab = { key: string; label: string; count?: number; content: React.ReactNode };

/** Card tabs with a sliding pill; panels cross-fade and slide (direction follows the tab order). */
export function TabPanel({ tabs, title, icon }: { tabs: DashTab[]; title: string; icon?: React.ReactNode }) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  const [dir, setDir] = useState(1);
  const idx = tabs.findIndex((t) => t.key === active);
  const current = tabs[idx];
  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[1.05rem] font-bold tracking-tight">
          {icon}
          {title}
        </h2>
        <div className="relative flex rounded-full bg-surface-2 p-1" role="tablist" aria-label={title}>
          {tabs.map((t, i) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={t.key === active}
              onClick={() => {
                setDir(i > idx ? 1 : -1);
                setActive(t.key);
              }}
              className={`relative z-[1] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${t.key === active ? "text-bg" : "text-ink-2 hover:text-ink"}`}
            >
              {t.key === active && <motion.span layoutId="dash-tab" className="absolute inset-0 -z-[1] rounded-full bg-ink" transition={{ type: "spring", stiffness: 420, damping: 32 }} />}
              {t.label}
              {t.count !== undefined && <span className={`rounded-full px-1.5 text-[0.62rem] tabular-nums ${t.key === active ? "bg-bg/20" : "bg-surface"}`}>{t.count}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="relative min-h-[220px] flex-1">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div key={active} role="tabpanel" custom={dir} initial={{ opacity: 0, x: 24 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 * dir }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
            {current?.content}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
