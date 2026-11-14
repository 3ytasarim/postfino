"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight, Home, Lightbulb, CalendarDays, MessagesSquare, LineChart, PenSquare, Clapperboard, Plug, Images, FileText, Settings, Hash, Loader2, type LucideIcon } from "lucide-react";
import { searchAction, type SearchHit } from "@/app/app/actions-search";
import { NetworkIcon } from "./network-icon";

type Row = { key: string; group: string; title: string; meta?: string; href: string; icon?: LucideIcon; platform?: string };
export type PaletteLabels = Record<"placeholder" | "pages" | "actions" | "results" | "empty" | "move" | "open" | "anywhere" | "searchButton" | "goTo" | "quick", string> & Record<string, string>;

/** App-wide command palette: Ctrl/⌘+K anywhere — pages, quick actions and live search over posts, ideas and channels. */
export function CommandPalette({ l, nav }: { l: PaletteLabels; nav: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, start] = useTransition();
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!open) {
      setQ("");
      setHits([]);
      setCursor(0);
    }
  }, [open]);
  // debounced server search
  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(() => start(async () => setHits(await searchAction(q))), 180);
    return () => clearTimeout(t);
  }, [q]);

  const rows: Row[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    const m = (s: string) => !term || s.toLowerCase().includes(term);
    const actions: Row[] = [
      { key: "a-post", group: l.actions, title: nav.composePost!, href: "/app/compose/post", icon: PenSquare },
      { key: "a-reel", group: l.actions, title: nav.compose!, href: "/app/compose/reel", icon: Clapperboard },
      { key: "a-idea", group: l.actions, title: nav.newIdea!, href: "/app/ideas?new=1", icon: Lightbulb },
      { key: "a-channel", group: l.actions, title: nav.connectNewChannel!, href: "/app/channels", icon: Plug },
    ].filter((r) => m(r.title));
    const pages: Row[] = [
      { key: "p-home", group: l.pages, title: nav.dashboard!, href: "/app", icon: Home },
      { key: "p-ideas", group: l.pages, title: nav.ideas!, href: "/app/ideas", icon: Lightbulb },
      { key: "p-publish", group: l.pages, title: nav.publish!, href: "/app/publish", icon: CalendarDays },
      { key: "p-calendar", group: l.pages, title: nav.calendar!, href: "/app/calendar", icon: CalendarDays },
      { key: "p-community", group: l.pages, title: nav.community!, href: "/app/community", icon: MessagesSquare },
      { key: "p-insights", group: l.pages, title: nav.insights!, href: "/app/insights", icon: LineChart },
      { key: "p-media", group: l.pages, title: nav.media!, href: "/app/media", icon: Images },
      { key: "p-reports", group: l.pages, title: nav.reports!, href: "/app/reports", icon: FileText },
      { key: "p-channels", group: l.pages, title: nav.channels!, href: "/app/channels", icon: Plug },
      { key: "p-settings", group: l.pages, title: nav.settings!, href: "/app/settings", icon: Settings },
    ].filter((r) => m(r.title));
    const found: Row[] = hits.map((h) => ({ key: `${h.kind}-${h.id}`, group: l.results, title: h.title, meta: h.meta, href: h.href, platform: h.platform, icon: h.kind === "idea" ? Lightbulb : Hash }));
    return [...found, ...actions, ...pages];
  }, [q, hits, l, nav]);

  const active = Math.min(cursor, Math.max(0, rows.length - 1));
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (r: Row) => {
    setOpen(false);
    router.push(r.href);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(rows.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && rows[active]) {
      e.preventDefault();
      go(rows[active]!);
    } else if (e.key === "Escape") setOpen(false);
  };

  let last: string | null = null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-[40px] w-full max-w-md items-center gap-2 rounded-[12px] border border-line bg-surface px-3 text-left text-sm text-ink-3 hover:border-ink-3" aria-label={l.searchButton}>
        <Search className="size-4" aria-hidden />
        <span className="flex-1 truncate">{l.searchButton}</span>
        <kbd className="hidden rounded-md border border-line px-1.5 font-mono text-[0.7rem] sm:inline">Ctrl K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 px-3 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={l.searchButton} className="palette-in w-full max-w-[620px] overflow-hidden rounded-[20px] border border-line bg-surface shadow-2xl">
            <label className="flex items-center gap-3 border-b border-line px-4">
              {pending ? <Loader2 className="size-5 animate-spin text-ink-3" aria-hidden /> : <Search className="size-5 text-ink-3" aria-hidden />}
              <input
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={onKey}
                placeholder={l.placeholder}
                className="min-h-[56px] flex-1 bg-transparent text-base outline-none placeholder:text-ink-3"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={rows[active] ? `pal-${rows[active]!.key}` : undefined}
              />
              <kbd className="rounded-md border border-line px-1.5 font-mono text-[0.7rem] text-ink-3">esc</kbd>
            </label>
            <div ref={listRef} id="palette-list" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
              {rows.length === 0 && <p className="px-3 py-8 text-center text-sm text-ink-3">{l.empty.replace("{q}", q)}</p>}
              {rows.map((r, i) => {
                const head = r.group !== last ? r.group : null;
                last = r.group;
                return (
                  <div key={r.key}>
                    {head && <p className="eyebrow px-3 pt-3 pb-1.5">{head}</p>}
                    <button
                      id={`pal-${r.key}`}
                      data-i={i}
                      role="option"
                      aria-selected={i === active}
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => go(r)}
                      className={`flex min-h-[48px] w-full items-center gap-3 rounded-[12px] px-3 text-left ${i === active ? "bg-surface-2" : ""}`}
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-bg text-ink-2">{r.platform ? <NetworkIcon platform={r.platform} badge size={22} className="!ring-0" /> : r.icon ? <r.icon className="size-4" aria-hidden /> : null}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{r.title}</span>
                        <span className="block truncate text-xs text-ink-3">{r.meta ?? (r.group === l.actions ? l.quick : l.goTo)}</span>
                      </span>
                      <ArrowRight className={`size-4 text-ink-3 transition-opacity ${i === active ? "opacity-100" : "opacity-0"}`} aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>
            <footer className="flex flex-wrap gap-4 border-t border-line px-4 py-2.5 text-xs text-ink-3">
              <span>
                <kbd className="rounded border border-line px-1 font-mono">↑</kbd> <kbd className="rounded border border-line px-1 font-mono">↓</kbd> {l.move}
              </span>
              <span>
                <kbd className="rounded border border-line px-1 font-mono">↵</kbd> {l.open}
              </span>
              <span className="ml-auto">
                <kbd className="rounded border border-line px-1 font-mono">Ctrl</kbd> <kbd className="rounded border border-line px-1 font-mono">K</kbd> {l.anywhere}
              </span>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
