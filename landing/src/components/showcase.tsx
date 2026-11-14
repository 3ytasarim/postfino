"use client";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Filter, Lightbulb, MessagesSquare, MousePointer2, Reply } from "lucide-react";
import { SectionHead, Reveal } from "./reveal";
import { NetworkIcon, networkColor } from "./network-icon";

const TABS = [
  { id: "kalender", label: "Kalender", icon: CalendarDays, title: "Die Woche auf einen Blick", text: "Beiträge per Drag & Drop verschieben, Lücken direkt füllen, Zeitzone wählen. Filter nach Kanal, Status und Tags." },
  { id: "ideen", label: "Ideen", icon: Lightbulb, title: "Vom Einfall zum Entwurf", text: "Spalten für Ideen, In Arbeit und Bereit. Eine Karte wird mit einem Klick zum geplanten Beitrag." },
  { id: "community", label: "Community", icon: MessagesSquare, title: "Antworten ohne App-Wechsel", text: "Kommentare der verbundenen Kanäle gesammelt, mit Status, Zuweisung und Antwort direkt aus Postfino." },
] as const;
type Tab = (typeof TABS)[number]["id"];

const HOUR_PX = 30;
const H0 = 8;
const GUTTER = 44;
const col = (i: number) => ({ left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${i} / 5 + 3px)`, width: `calc((100% - ${GUTTER}px) / 5 - 6px)` });
const at = (h: number) => (h - H0) * HOUR_PX;
const CAL_POSTS: { c: number; h: number; p: string; title: string; done?: boolean }[] = [
  { c: 0, h: 9, p: "instagram_business", title: "Neues Menü ab Freitag", done: true },
  { c: 0, h: 14.5, p: "linkedin_page", title: "3 Tipps für Reichweite" },
  { c: 1, h: 11, p: "facebook_page", title: "Event-Ankündigung", done: true },
  { c: 1, h: 16.5, p: "youtube", title: "Tutorial: Teil 2" },
  { c: 2, h: 9.5, p: "tiktok", title: "Behind the scenes", done: true },
  { c: 2, h: 15, p: "threads", title: "Frage an die Community" },
  { c: 3, h: 10, p: "x", title: "Kurz-Update zum Launch" },
  { c: 4, h: 9.5, p: "instagram_business", title: "Wochenrückblick" },
  { c: 4, h: 16, p: "bluesky", title: "Sonntagsfrage vorab" },
];

function PostBlock({ p, title, h, done, lifted = false }: { p: string; title: string; h: number; done?: boolean; lifted?: boolean }) {
  const c = networkColor(p);
  const hh = String(Math.floor(h)).padStart(2, "0");
  const mm = h % 1 ? "30" : "00";
  return (
    <div className={`flex h-[52px] flex-col justify-center overflow-hidden rounded-lg border-l-[3px] px-2 ${lifted ? "bg-white shadow-[0_18px_36px_-12px_rgba(16,40,110,0.55)] ring-2 ring-sky" : "shadow-sm"}`} style={{ borderLeftColor: c, background: lifted ? undefined : `color-mix(in srgb, ${c} 9%, white)` }}>
      <span className="flex items-center gap-1 text-[0.62rem] font-bold text-ink-2">
        <NetworkIcon platform={p} badge size={14} />
        {hh}:{mm}
        {done && <CheckCircle2 className="ml-auto size-3 text-mint" />}
      </span>
      <span className="mt-0.5 truncate text-[0.7rem] font-semibold text-ink">{title}</span>
    </div>
  );
}

function CalendarView() {
  const days = [["Mo", 10], ["Di", 11], ["Mi", 12], ["Do", 13], ["Fr", 14]] as const;
  const hours = [8, 10, 12, 14, 16, 18];
  const height = (19 - H0) * HOUR_PX;
  const drag = { duration: 5, times: [0, 0.15, 0.6, 0.75, 1], repeat: Infinity, repeatDelay: 1, ease: "easeInOut" as const };
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-line">
      {/* toolbar */}
      <div className="flex items-center gap-2 pb-3">
        <span className="flex items-center gap-0.5">
          <span className="grid size-7 place-items-center rounded-lg ring-1 ring-line">
            <ChevronLeft className="size-3.5" />
          </span>
          <span className="grid size-7 place-items-center rounded-lg ring-1 ring-line">
            <ChevronRight className="size-3.5" />
          </span>
        </span>
        <span className="font-display text-sm font-bold">10. – 14. November</span>
        <span className="ml-auto hidden items-center rounded-lg bg-paper p-0.5 text-[0.7rem] font-semibold ring-1 ring-line sm:flex">
          <span className="rounded-md bg-white px-2 py-1 shadow-sm">Woche</span>
          <span className="px-2 py-1 text-ink-3">Monat</span>
          <span className="px-2 py-1 text-ink-3">Liste</span>
        </span>
        <span className="flex -space-x-1.5">
          {["instagram_business", "linkedin_page", "tiktok", "youtube"].map((p) => (
            <NetworkIcon key={p} platform={p} badge size={22} />
          ))}
        </span>
        <span className="flex items-center gap-1 rounded-lg px-2 py-1 text-[0.7rem] font-semibold ring-1 ring-line">
          <Filter className="size-3" /> Filter
        </span>
      </div>
      {/* day header */}
      <div className="grid border-b border-line pb-2" style={{ gridTemplateColumns: `${GUTTER}px repeat(5, 1fr)` }}>
        <span className="self-end text-[0.6rem] font-semibold text-ink-3">MEZ</span>
        {days.map(([d, n], i) => (
          <span key={d} className="flex items-center justify-center gap-1.5 text-xs">
            <span className="font-semibold text-ink-3 uppercase">{d}</span>
            <span className={`grid size-6 place-items-center rounded-full font-display font-bold ${i === 2 ? "bg-cobalt text-white" : ""}`}>{n}</span>
          </span>
        ))}
      </div>
      {/* hour grid */}
      <div className="relative mt-3" style={{ height }}>
        {hours.map((h) => (
          <div key={h} className="absolute inset-x-0 flex items-start" style={{ top: at(h) }}>
            <span className="w-[44px] -translate-y-1.5 pr-2 text-right text-[0.6rem] font-semibold text-ink-3">{h}:00</span>
            <span className="h-px flex-1 bg-line/70" />
          </div>
        ))}
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="absolute top-0 bottom-0 w-px bg-line/50" style={{ left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${i} / 5)` }} />
        ))}
        <span className="absolute top-0 bottom-0 rounded-md bg-cobalt/[0.04]" style={col(2)} />

        {CAL_POSTS.map((x, k) => (
          <motion.div key={k} className="absolute" style={{ top: at(x.h) + 2, ...col(x.c) }} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05 * k, type: "spring", stiffness: 320, damping: 24 }}>
            <PostBlock {...x} />
          </motion.div>
        ))}

        {/* "now" line in today's column */}
        <motion.div className="absolute z-10 flex items-center" style={col(2)} initial={{ top: at(12.6) }} animate={{ top: [at(12.6), at(13.4), at(12.6)] }} transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}>
          <span className="-ml-1 size-2.5 rounded-full bg-[#ef4444] ring-2 ring-white" />
          <span className="h-[2px] flex-1 bg-[#ef4444]" />
        </motion.div>

        {/* drag demo: Do 13:00 -> Fr 12:00, dashed ghost stays at the origin */}
        <motion.span className="absolute h-[52px] rounded-lg border-2 border-dashed border-sky/60" style={{ top: at(13) + 2, ...col(3) }} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0, 0] }} transition={drag} />
        <motion.div className="absolute z-20" style={col(3)} initial={{ top: at(13) + 2 }} animate={{ top: [at(13) + 2, at(13) + 2, at(12) + 2, at(12) + 2, at(13) + 2], x: ["0%", "0%", "108%", "108%", "0%"], rotate: [0, -3, -3, 0, 0], scale: [1, 1.05, 1.05, 1, 1] }} transition={drag}>
          <PostBlock p="pinterest" title="Moodboard Herbst" h={13} lifted />
          <MousePointer2 className="absolute -right-2 -bottom-3 size-5 fill-ink text-white drop-shadow" />
        </motion.div>
      </div>
      <div className="mt-3 flex items-center gap-3 border-t border-line pt-3 text-[0.7rem] font-semibold">
        <span className="rounded-full bg-paper px-2.5 py-1 ring-1 ring-line">Ohne Datum · 2</span>
        <span className="flex items-center gap-1 text-ink-3">
          <CheckCircle2 className="size-3 text-mint" /> veröffentlicht
        </span>
        <span className="ml-auto rounded-full bg-cobalt px-3 py-1 text-white">+ Beitrag</span>
      </div>
    </div>
  );
}

function IdeasView() {
  const cols = [
    ["Ideen", ["Kundenstimme als Karussell", "Team-Vorstellung", "FAQ-Reel"]],
    ["In Arbeit", ["Sommer-Aktion", "Blogartikel teasern"]],
    ["Bereit", ["Produkt-Launch"]],
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-3">
      {cols.map(([name, items], ci) => (
        <div key={name} className="rounded-2xl bg-paper/80 p-2.5 ring-1 ring-line">
          <p className="mb-2 px-1 text-xs font-bold text-ink-3">
            {name} <span className="font-medium">· {items.length}</span>
          </p>
          {items.map((it, i) => (
            <motion.div key={it} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + ci * 0.1 + i * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="mb-2 rounded-xl bg-white p-2.5 text-sm font-medium shadow-sm ring-1 ring-line">
              {it}
              {ci === 2 && (
                <span className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-mint">
                  <CheckCircle2 className="size-3.5" /> Freigegeben
                </span>
              )}
            </motion.div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CommunityView() {
  const msgs = [
    ["instagram_business", "@lea.k", "Gibt es das auch in Blau?", true],
    ["facebook_page", "Markus B.", "Super Beratung heute, danke!", false],
    ["youtube", "@techfan", "Kommt noch ein Teil 3?", false],
  ] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1.1fr]">
      <ul className="space-y-2">
        {msgs.map(([p, who, t, active], i) => (
          <motion.li key={who} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.08 }} className={`flex items-start gap-2.5 rounded-2xl p-3 ring-1 ${active ? "bg-white ring-sky" : "bg-paper/80 ring-line"}`}>
            <NetworkIcon platform={p} badge size={24} />
            <span className="min-w-0">
              <span className="block text-xs font-bold">{who}</span>
              <span className="block truncate text-sm text-ink-2">{t}</span>
            </span>
          </motion.li>
        ))}
      </ul>
      <div className="flex flex-col rounded-2xl bg-white p-4 ring-1 ring-line">
        <p className="text-xs font-bold text-ink-3">@lea.k auf Instagram</p>
        <p className="mt-2 w-fit rounded-2xl rounded-tl-sm bg-paper px-3 py-2 text-sm">Gibt es das auch in Blau?</p>
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="mt-2 ml-auto w-fit rounded-2xl rounded-tr-sm bg-cobalt px-3 py-2 text-sm text-white">
          Ja! Ab Montag wieder im Laden 💙
        </motion.p>
        <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-xs font-semibold text-cobalt-2">
          <Reply className="size-3.5" /> Antwort direkt aus Postfino
        </span>
      </div>
    </div>
  );
}

const ROTATE_MS = 8000;
const POINTS: Record<Tab, string[]> = {
  kalender: ["Woche, Monat oder Liste", "Drag & Drop zum Umplanen", "Filter nach Kanal, Status & Tags", "Zeitzone frei wählbar"],
  ideen: ["Spalten: Ideen, In Arbeit, Bereit", "Ideen mit Notizen & Medien", "Ein Klick: Idee → Entwurf", "Gemeinsam im Team"],
  community: ["Kommentare aller Kanäle an einem Ort", "Status pro Unterhaltung", "Direkt aus Postfino antworten", "Filter nach Kanal"],
};

export function Showcase() {
  const [tab, setTab] = useState<Tab>("kalender");
  const [paused, setPaused] = useState(false);
  const cur = TABS.find((t) => t.id === tab)!;
  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setTimeout(() => {
      const i = TABS.findIndex((t) => t.id === tab);
      setTab(TABS[(i + 1) % TABS.length].id);
    }, ROTATE_MS);
    return () => window.clearTimeout(id);
  }, [tab, paused]);
  return (
    <section className="relative px-4 py-24 sm:py-32" aria-labelledby="showcase">
      <SectionHead eyebrow="Einblick" title={<span id="showcase">Gebaut für den Arbeitsalltag.</span>} />
      <Reveal className="mx-auto mt-10 flex justify-center">
        <div role="tablist" aria-label="Bereiche der Anwendung" className="glass inline-flex rounded-full p-1.5">
          {TABS.map(({ id, label, icon: I }) => (
            <button key={id} role="tab" aria-selected={tab === id} aria-controls="showcase-panel" onClick={() => setTab(id)} className={`relative flex min-h-11 items-center gap-2 overflow-hidden rounded-full px-4 text-sm font-semibold transition-colors sm:px-5 ${tab === id ? "text-white" : "text-ink-2 hover:text-ink"}`}>
              {tab === id && (
                <motion.span layoutId="tab-pill" className="absolute inset-0 overflow-hidden rounded-full bg-ink" transition={{ type: "spring", stiffness: 380, damping: 32 }}>
                  {!paused && <motion.span key={tab} className="absolute inset-y-0 left-0 bg-white/15" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: ROTATE_MS / 1000, ease: "linear" }} />}
                </motion.span>
              )}
              <I className="relative size-4" />
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
      </Reveal>
      <Reveal className="mx-auto mt-8 max-w-6xl">
        <div id="showcase-panel" role="tabpanel" aria-label={cur.title} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} className="glass grid gap-6 overflow-hidden rounded-[32px] p-4 sm:p-6 lg:grid-cols-[0.7fr_2fr] lg:items-center">
          {/* All tabs are stacked in one grid cell: the box keeps the height of the tallest one, so switching never moves the page. */}
          <div className="grid">
            {TABS.map((tb) => {
              const on = tb.id === tab;
              return (
                <motion.div key={tb.id} aria-hidden={!on} className={`px-2 [grid-area:1/1] ${on ? "" : "pointer-events-none"}`} initial={false} animate={on ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }} transition={{ duration: 0.35, delay: on ? 0.15 : 0 }}>
                  <span className="grid size-11 place-items-center rounded-2xl bg-cobalt text-white shadow-[0_12px_24px_-10px_#0047ab]">
                    <tb.icon className="size-5" />
                  </span>
                  <h3 className="mt-5 font-display text-2xl font-bold tracking-tight">{tb.title}</h3>
                  <p className="mt-3 leading-relaxed text-ink-2">{tb.text}</p>
                  <ul className="mt-5 space-y-2.5">
                    {POINTS[tb.id].map((pt, i) => (
                      <motion.li key={pt} initial={false} animate={on ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }} transition={{ delay: on ? 0.2 + i * 0.07 : 0 }} className="flex items-center gap-2.5 text-sm font-medium">
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-mint/15 text-mint">
                          <Check className="size-3" strokeWidth={3} />
                        </span>
                        {pt}
                      </motion.li>
                    ))}
                  </ul>
                </motion.div>
              );
            })}
          </div>
          <div className="overflow-x-auto rounded-[24px] bg-gradient-to-br from-[#eef3ff] via-white to-[#f3efff] p-3 sm:p-4">
            <div className="grid min-w-[560px]">
              {TABS.map((tb) => {
                const on = tb.id === tab;
                return (
                  <motion.div key={tb.id} aria-hidden={!on} className={`[grid-area:1/1] ${on ? "" : "pointer-events-none"}`} initial={false} animate={on ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: on ? 0.12 : 0 }}>
                    {tb.id === "kalender" ? <CalendarView key={on ? "on" : "off"} /> : tb.id === "ideen" ? <IdeasView /> : <CommunityView />}
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
