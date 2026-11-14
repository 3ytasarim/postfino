"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { BarChart3, CalendarDays, Check, Lock, Settings, CheckCircle2, ChevronLeft, ChevronRight, Filter, Lightbulb, MessagesSquare, MousePointer2, Reply } from "lucide-react";
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

/** Milliseconds into a repeating `period` while `on`; resets when the tab is left. Reduced motion → final frame. */
function useLoop(on: boolean, period: number) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!on) {
      setT(0);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setT(period - 1);
      return;
    }
    const start = performance.now();
    const id = window.setInterval(() => {
      if (!document.hidden) setT((performance.now() - start) % period);
    }, 80);
    return () => window.clearInterval(id);
  }, [on, period]);
  return t;
}

type Idea = { id: string; title: string; tag: string; tone: string; who: string; thumb?: string };
const IDEAS: Record<string, Idea> = {
  kunde: { id: "kunde", title: "Kundenstimme als Karussell", tag: "Social Proof", tone: "bg-sky/15 text-cobalt-2", who: "LK", thumb: "from-sky/50 to-lilac/50" },
  team: { id: "team", title: "Team-Vorstellung", tag: "Employer", tone: "bg-lilac/15 text-lilac", who: "MB" },
  faq: { id: "faq", title: "FAQ-Reel", tag: "Reel", tone: "bg-[#ff4d8d]/12 text-[#d6336c]", who: "AS", thumb: "from-[#ff8a65]/60 to-[#ff4d8d]/50" },
  sommer: { id: "sommer", title: "Sommer-Aktion", tag: "Kampagne", tone: "bg-mint/15 text-[#0f8f72]", who: "LK", thumb: "from-mint/50 to-sky/40" },
  blog: { id: "blog", title: "Blogartikel teasern", tag: "Content", tone: "bg-sky/15 text-cobalt-2", who: "MB" },
  launch: { id: "launch", title: "Produkt-Launch", tag: "Launch", tone: "bg-cobalt/10 text-cobalt", who: "AS", thumb: "from-cobalt/50 to-sky/50" },
  umfrage: { id: "umfrage", title: "Umfrage: Lieblingsfarbe?", tag: "Story", tone: "bg-lilac/15 text-lilac", who: "LK" },
};
const IDEA_STEP = 2000;

function IdeaCard({ it, moving, approved, fresh }: { it: Idea; moving: boolean; approved: boolean; fresh: boolean }) {
  return (
    <motion.div
      layout
      layoutId={`idea-${it.id}`}
      initial={fresh ? { opacity: 0, scale: 0.85, y: -10 } : false}
      animate={{ opacity: 1, scale: moving ? 1.04 : 1, rotate: moving ? -2 : 0, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
      className={`relative mb-2 rounded-xl bg-white p-2.5 ${moving ? "z-10 shadow-[0_18px_36px_-12px_rgba(16,40,110,0.5)] ring-2 ring-sky" : fresh ? "shadow-sm ring-2 ring-mint/60" : "shadow-sm ring-1 ring-line"}`}
    >
      {it.thumb && <span className={`mb-2 block h-10 rounded-lg bg-gradient-to-br ${it.thumb}`} />}
      <span className="block text-[0.8rem] leading-snug font-semibold">{it.title}</span>
      <span className="mt-2 flex items-center gap-1.5">
        <span className={`rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold ${it.tone}`}>{it.tag}</span>
        {fresh && <span className="rounded-full bg-mint px-1.5 py-0.5 text-[0.6rem] font-bold text-white">Neu</span>}
        <span className="ml-auto grid size-5 place-items-center rounded-full bg-ink text-[0.55rem] font-bold text-white">{it.who}</span>
      </span>
      {approved && (
        <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex items-center gap-1 text-[0.68rem] font-semibold text-mint">
          <CheckCircle2 className="size-3.5" /> Freigegeben
        </motion.span>
      )}
      {moving && <MousePointer2 className="absolute -right-2 -bottom-3 size-5 fill-ink text-white drop-shadow" />}
    </motion.div>
  );
}

function IdeasView({ on }: { on: boolean }) {
  const t = useLoop(on, IDEA_STEP * 4);
  const s = Math.floor(t / IDEA_STEP); // 0 rest · 1 FAQ → In Arbeit · 2 FAQ → Bereit · 3 new idea
  const cols: [string, string[]][] = [
    ["Ideen", [...(s === 3 ? ["umfrage"] : []), "kunde", "team", ...(s === 0 ? ["faq"] : [])]],
    ["In Arbeit", [...(s === 1 ? ["faq"] : []), "sommer", "blog"]],
    ["Bereit", [...(s >= 2 ? ["faq"] : []), "launch"]],
  ];
  return (
    <div className="flex h-full flex-col rounded-2xl bg-white p-3 shadow-sm ring-1 ring-line">
      <div className="flex items-center gap-2 pb-3">
        <span className="font-display text-sm font-bold">Ideen-Board</span>
        <span className="rounded-full bg-paper px-2 py-0.5 text-[0.65rem] font-semibold text-ink-3 ring-1 ring-line">Herbst-Kampagne</span>
        <span className="ml-auto flex -space-x-1.5">
          {["LK", "MB", "AS"].map((w, i) => (
            <span key={w} className={`grid size-6 place-items-center rounded-full text-[0.55rem] font-bold text-white ring-2 ring-white ${["bg-cobalt", "bg-lilac", "bg-mint"][i]}`}>
              {w}
            </span>
          ))}
        </span>
        <span className="rounded-full bg-cobalt px-3 py-1 text-[0.7rem] font-semibold text-white">+ Idee</span>
      </div>
      <LayoutGroup>
        <div className="grid flex-1 grid-cols-3 gap-2.5">
          {cols.map(([name, ids], ci) => (
            <div key={name} className={`flex flex-col rounded-2xl p-2 ring-1 transition-colors duration-500 ${(s === 1 && ci === 1) || (s === 2 && ci === 2) ? "bg-sky/10 ring-sky/40" : "bg-paper/80 ring-line"}`}>
              <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-bold text-ink-3">
                <span className={`size-2 rounded-full ${["bg-lilac", "bg-sky", "bg-mint"][ci]}`} />
                {name}
                <motion.span key={ids.length} initial={{ scale: 1.5 }} animate={{ scale: 1 }} className="font-medium">
                  · {ids.length}
                </motion.span>
              </p>
              {ids.map((id) => (
                <IdeaCard key={id} it={IDEAS[id]} moving={id === "faq" && (s === 1 || s === 2)} approved={ci === 2} fresh={id === "umfrage"} />
              ))}
            </div>
          ))}
        </div>
      </LayoutGroup>
    </div>
  );
}

const INBOX = [
  { p: "instagram_business", who: "@lea.k", text: "Gibt es das auch in Blau?" },
  { p: "facebook_page", who: "Markus B.", text: "Super Beratung heute, danke!", done: true },
  { p: "youtube", who: "@techfan", text: "Kommt noch ein Teil 3?" },
  { p: "tiktok", who: "@mia.sun", text: "Welcher Song ist das? 😍", done: true },
];
const REPLY = "Ja! Ab Montag wieder im Laden 💙";
const COMM_PERIOD = 8000;

function CommunityView({ on }: { on: boolean }) {
  const t = useLoop(on, COMM_PERIOD);
  const arrived = t > 500;
  const opened = t > 1300;
  const typing = t > 2300 && t < 3900;
  const typed = REPLY.slice(0, Math.max(0, Math.min(REPLY.length, Math.floor(((t - 2300) / 1400) * REPLY.length))));
  const sent = t > 3900;
  const done = t > 4700;
  const list = arrived ? INBOX : INBOX.slice(1);
  const open = list.filter((m) => !m.done && !(m.who === "@lea.k" && done)).length;
  return (
    <div className="grid h-full grid-cols-[1fr_1.15fr] gap-3">
      <div className="flex flex-col overflow-hidden rounded-2xl bg-white p-3 shadow-sm ring-1 ring-line">
        <div className="mb-3 flex items-center gap-1 rounded-lg bg-paper p-0.5 text-[0.68rem] font-semibold ring-1 ring-line">
          <span className="rounded-md bg-white px-2 py-1 shadow-sm">Alle · {list.length}</span>
          <span className="px-2 py-1 text-ink-3">
            Offen ·{" "}
            <motion.span key={open} initial={{ scale: 1.6, color: "#0047ab" }} animate={{ scale: 1, color: "#6b7280" }} className="inline-block">
              {open}
            </motion.span>
          </span>
          <span className="px-2 py-1 text-ink-3">Erledigt</span>
        </div>
        <ul className="relative -mx-1.5 flex-1 space-y-2 overflow-hidden px-1.5 py-1">
          <AnimatePresence initial={false} mode="popLayout">
            {list.map((m) => {
              const active = m.who === "@lea.k" && opened;
              const isDone = m.done || (m.who === "@lea.k" && done);
              return (
                <motion.li
                  layout
                  key={m.who}
                  initial={{ opacity: 0, y: -28, scale: 0.92 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 340, damping: 28 }}
                  className={`flex items-start gap-2.5 rounded-xl p-2.5 transition-colors duration-300 ${active ? "bg-white shadow-[0_10px_24px_-14px_rgba(16,40,110,0.55)] ring-2 ring-sky" : "bg-paper/80 ring-1 ring-line"}`}
                >
                  <NetworkIcon platform={m.p} badge size={22} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.7rem] font-bold">{m.who}</span>
                    <span className="block truncate text-[0.75rem] text-ink-2">{m.text}</span>
                  </span>
                  {isDone ? <CheckCircle2 className="size-4 shrink-0 text-mint" /> : <span className="mt-1 size-2 shrink-0 rounded-full bg-sky" />}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>

      <div className="flex flex-col rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-line">
        <div className="flex items-center gap-2 border-b border-line pb-2.5">
          <NetworkIcon platform="instagram_business" badge size={22} />
          <span className="text-[0.75rem] font-bold">@lea.k</span>
          <span className="text-[0.68rem] text-ink-3">auf Instagram</span>
          <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.62rem] font-bold transition-colors duration-500 ${done ? "bg-mint/15 text-[#0f8f72]" : "bg-sky/15 text-cobalt-2"}`}>
            {done && <Check className="size-3" strokeWidth={3} />}
            {done ? "Beantwortet" : "Offen"}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-2 py-3">
          <AnimatePresence>
            {opened && (
              <motion.p key="in" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="w-fit rounded-2xl rounded-tl-sm bg-paper px-3 py-2 text-[0.8rem]">
                Gibt es das auch in Blau?
              </motion.p>
            )}
            {typing && (
              <motion.span key="dots" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="ml-auto flex w-fit gap-1 rounded-2xl rounded-tr-sm bg-cobalt/10 px-3 py-2.5">
                {[0, 1, 2].map((i) => (
                  <motion.span key={i} className="size-1.5 rounded-full bg-cobalt" animate={{ y: [0, -3, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.12 }} />
                ))}
              </motion.span>
            )}
            {sent && (
              <motion.p key="out" initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 24 }} className="ml-auto w-fit rounded-2xl rounded-tr-sm bg-cobalt px-3 py-2 text-[0.8rem] text-white">
                {REPLY}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-paper py-1.5 pr-1.5 pl-3 ring-1 ring-line">
          <span className="min-w-0 flex-1 truncate text-[0.75rem] text-ink-2">
            {typing ? typed : <span className="text-ink-3">Antwort schreiben…</span>}
            {typing && <span className="ml-px inline-block h-3.5 w-px translate-y-0.5 animate-pulse bg-ink" />}
          </span>
          <motion.span animate={{ scale: typing && typed.length === REPLY.length ? [1, 1.15, 1] : 1 }} className="grid size-7 place-items-center rounded-full bg-cobalt text-white">
            <Reply className="size-3.5" />
          </motion.span>
        </div>
        <span className="mt-2 inline-flex items-center gap-1.5 text-[0.68rem] font-semibold text-cobalt-2">
          <Reply className="size-3" /> Antwort direkt aus Postfino
        </span>
      </div>
    </div>
  );
}

const ROTATE_MS = 8000;

/** Below `min` px the mockup keeps its desktop layout and is scaled down as a whole, like a screenshot. */
function FitScale({ min, children }: { min: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ s: 1, h: 0 });
  useLayoutEffect(() => {
    const el = box.current, inn = inner.current;
    if (!el || !inn) return;
    const measure = () => {
      const s = Math.min(1, el.clientWidth / min);
      setFit((p) => (p.s === s && p.h === inn.offsetHeight ? p : { s, h: inn.offsetHeight }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(inn);
    return () => ro.disconnect();
  }, [min]);
  const scaled = fit.s < 1;
  return (
    <div ref={box} className="relative min-w-0" style={scaled ? { height: fit.h * fit.s } : undefined}>
      <div ref={inner} style={scaled ? { position: "absolute", left: 0, top: 0, width: min, transform: `scale(${fit.s})`, transformOrigin: "top left" } : undefined}>
        {children}
      </div>
    </div>
  );
}
const URL_PATH: Record<Tab, string> = { kalender: "calendar", ideen: "ideas", community: "community" };
const RAIL: { id: string; icon: typeof CalendarDays }[] = [
  { id: "kalender", icon: CalendarDays },
  { id: "ideen", icon: Lightbulb },
  { id: "community", icon: MessagesSquare },
  { id: "insights", icon: BarChart3 },
  { id: "settings", icon: Settings },
];
const POINTS: Record<Tab, string[]> = {
  kalender: ["Woche, Monat oder Liste", "Drag & Drop zum Umplanen", "Filter nach Kanal, Status & Tags", "Zeitzone frei wählbar"],
  ideen: ["Spalten: Ideen, In Arbeit, Bereit", "Ideen mit Notizen & Medien", "Ein Klick: Idee → Entwurf", "Gemeinsam im Team"],
  community: ["Kommentare aller Kanäle an einem Ort", "Status pro Unterhaltung", "Direkt aus Postfino antworten", "Filter nach Kanal"],
};

export function Showcase() {
  const [tab, setTab] = useState<Tab>("kalender");
  const [paused, setPaused] = useState(false);
  const cur = TABS.find((t) => t.id === tab)!;
  // highlight walks through the bullet points of the open tab
  const pt = useLoop(true, 4 * 1800);
  const ptIdx = Math.floor(pt / 1800);
  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setTimeout(() => {
      const i = TABS.findIndex((t) => t.id === tab);
      setTab(TABS[(i + 1) % TABS.length].id);
    }, ROTATE_MS);
    return () => window.clearTimeout(id);
  }, [tab, paused]);
  return (
    <section className="relative px-4 py-14 sm:py-20" aria-labelledby="showcase">
      <SectionHead eyebrow="Einblick" title={<span id="showcase">Gebaut für den Arbeitsalltag.</span>} />
      <Reveal className="mx-auto mt-8 flex justify-center">
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
                  <ul className="-mx-2 mt-4 space-y-1">
                    {POINTS[tb.id].map((label, i) => {
                      const lit = on && i === ptIdx;
                      return (
                        <motion.li key={label} initial={false} animate={on ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }} transition={{ delay: on ? 0.2 + i * 0.07 : 0 }} className={`relative flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm font-medium transition-colors duration-300 ${lit ? "text-ink" : "text-ink-2"}`}>
                          {lit && <motion.span layoutId={`pt-${tb.id}`} className="absolute inset-0 rounded-xl bg-white shadow-[0_8px_20px_-12px_rgba(0,71,171,0.45)] ring-1 ring-cobalt/10" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
                          <motion.span className={`relative grid size-5 shrink-0 place-items-center rounded-full transition-colors duration-300 ${lit ? "bg-mint text-white" : "bg-mint/15 text-mint"}`} animate={{ scale: lit ? [1, 1.25, 1] : 1 }} transition={{ duration: 0.45 }}>
                            <Check className="size-3" strokeWidth={3} />
                          </motion.span>
                          <span className="relative">{label}</span>
                        </motion.li>
                      );
                    })}
                  </ul>
                </motion.div>
              );
            })}
          </div>
          <div className="rounded-[24px] bg-gradient-to-br from-[#eef3ff] via-white to-[#f3efff] p-2.5 sm:p-3">
            {/* app window mockup: title bar with address, icon rail, the live view */}
            <FitScale min={640}>
              <div className="overflow-hidden rounded-[18px] bg-[#f4f7fd] shadow-[0_24px_60px_-28px_rgba(16,40,110,0.45)] ring-1 ring-line">
                <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-2.5">
                  <span className="flex gap-1.5" aria-hidden>
                    <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                    <span className="size-2.5 rounded-full bg-[#febc2e]" />
                    <span className="size-2.5 rounded-full bg-[#28c840]" />
                  </span>
                  <span className="mx-auto flex w-[min(320px,60%)] items-center justify-center gap-1.5 rounded-lg bg-paper px-3 py-1 text-[0.68rem] font-medium text-ink-3 ring-1 ring-line">
                    <Lock className="size-3" />
                    app.postfino.com/app/
                    <span className="relative inline-block h-4 w-[4.6rem] overflow-hidden text-left">
                      <AnimatePresence initial={false} mode="popLayout">
                        <motion.span key={tab} className="absolute inset-0 font-semibold text-ink" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 30 }}>
                          {URL_PATH[tab]}
                        </motion.span>
                      </AnimatePresence>
                    </span>
                  </span>
                  <span className="grid size-6 place-items-center rounded-full bg-cobalt text-[0.55rem] font-bold text-white">LK</span>
                </div>
                <div className="flex">
                  <nav aria-hidden className="flex w-12 shrink-0 flex-col items-center gap-1.5 border-r border-line bg-white py-3">
                    <span className="mb-2 grid size-7 place-items-center rounded-lg bg-cobalt text-[0.7rem] font-extrabold text-white">P</span>
                    {RAIL.map(({ id, icon: I }) => (
                      <span key={id} className={`relative grid size-8 place-items-center rounded-lg ${id === tab ? "text-cobalt" : "text-ink-3"}`}>
                        {id === tab && <motion.span layoutId="rail-pill" className="absolute inset-0 rounded-lg bg-cobalt/10 ring-1 ring-cobalt/20" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
                        <I className="relative size-4" />
                      </span>
                    ))}
                  </nav>
                  <div className="grid flex-1 p-3">
                    {TABS.map((tb) => {
                      const on = tb.id === tab;
                      return (
                        <motion.div key={tb.id} aria-hidden={!on} className={`[grid-area:1/1] ${on ? "" : "pointer-events-none"}`} initial={false} animate={on ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: on ? 0.12 : 0 }}>
                          {tb.id === "kalender" ? <CalendarView key={on ? "on" : "off"} /> : tb.id === "ideen" ? <IdeasView on={on} /> : <CommunityView on={on} />}
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </FitScale>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
