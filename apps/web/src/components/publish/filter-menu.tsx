"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Search } from "lucide-react";

export type FilterOption = { value: string; label: string; icon?: React.ReactNode; hint?: string };

/**
 * Toolbar filter as a popover. Writes its selection to the URL (`param`, comma separated when `multi`) so the
 * server renders the filtered calendar and the view can be shared or bookmarked.
 */
export function FilterMenu({ param, label, icon, options, multi = false, allLabel, searchable = false, align = "left" }: { param: string; label: string; icon: React.ReactNode; options: FilterOption[]; multi?: boolean; allLabel?: string; searchable?: boolean; align?: "left" | "right" }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = (sp.get(param) ?? "").split(",").filter(Boolean);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const apply = (values: string[]) => {
    const next = new URLSearchParams(sp.toString());
    if (values.length) next.set(param, values.join(","));
    else next.delete(param);
    router.push(`${path}?${next}`, { scroll: false });
  };
  const toggle = (v: string) => {
    if (!multi) {
      apply(selected[0] === v ? [] : [v]);
      setOpen(false);
      return;
    }
    apply(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };
  const current = !multi && selected[0] ? options.find((o) => o.value === selected[0])?.label : null;
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[0.82rem] font-medium transition-colors ${selected.length ? "bg-takt-soft text-takt" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
      >
        {icon}
        <span className="whitespace-nowrap">{current ?? label}</span>
        {multi && selected.length > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-takt px-1 text-[0.62rem] font-bold text-takt-ink">{selected.length}</span>}
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-multiselectable={multi}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", stiffness: 460, damping: 32 }}
            className={`absolute top-[calc(100%+6px)] z-40 max-h-[360px] w-[260px] overflow-y-auto rounded-[16px] bg-surface p-1.5 shadow-[0_20px_50px_-18px_rgb(0_0_0/0.4)] ring-1 ring-line ${align === "right" ? "right-0" : "left-0"}`}
          >
            {searchable && (
              <label className="mb-1 flex items-center gap-2 rounded-[10px] bg-surface-2 px-2.5">
                <Search className="size-3.5 text-ink-3" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={label} className="h-9 w-full bg-transparent text-sm outline-none" />
              </label>
            )}
            {allLabel && (
              <button onClick={() => (apply([]), setOpen(false))} className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm hover:bg-surface-2">
                <span className={`grid size-4 place-items-center rounded-[5px] border ${selected.length === 0 ? "border-takt bg-takt text-takt-ink" : "border-line"}`}>{selected.length === 0 && <Check className="size-3" strokeWidth={3} />}</span>
                {allLabel}
              </button>
            )}
            {shown.map((o) => {
              const on = selected.includes(o.value);
              return (
                <button key={o.value} role="option" aria-selected={on} onClick={() => toggle(o.value)} className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm hover:bg-surface-2">
                  <span className={`grid size-4 shrink-0 place-items-center border ${multi ? "rounded-[5px]" : "rounded-full"} ${on ? "border-takt bg-takt text-takt-ink" : "border-line"}`}>{on && <Check className="size-3" strokeWidth={3} />}</span>
                  {o.icon}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="text-xs tabular-nums text-ink-3">{o.hint}</span>}
                </button>
              );
            })}
            {shown.length === 0 && <p className="px-2.5 py-3 text-center text-xs text-ink-3">—</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
