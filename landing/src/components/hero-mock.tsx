"use client";
import { useReady } from "@/lib/use-ready";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { CalendarDays, Check, Clock3, Home, ImageIcon, Lightbulb, LineChart, MessagesSquare, MousePointer2, Plus, Sparkles, X } from "lucide-react";
import { NETWORK_NAMES, NetworkIcon } from "./network-icon";

const EASE = [0.16, 1, 0.3, 1] as const;
const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
// demo content of the product mock (illustration, not customer data)
const POSTS: { day: number; time: string; p: string; text: string; tone: string }[] = [
  { day: 0, time: "09:00", p: "instagram_business", text: "Neues Menü ab Freitag", tone: "from-pink-200 to-orange-100" },
  { day: 1, time: "12:30", p: "linkedin_page", text: "3 Tipps für mehr Reichweite", tone: "from-sky-200 to-blue-100" },
  { day: 2, time: "18:00", p: "tiktok", text: "Behind the scenes", tone: "from-slate-200 to-zinc-100" },
  { day: 3, time: "10:15", p: "facebook_page", text: "Event-Ankündigung", tone: "from-blue-200 to-indigo-100" },
  { day: 4, time: "17:45", p: "youtube", text: "Tutorial: Teil 2", tone: "from-red-200 to-rose-100" },
  { day: 5, time: "11:00", p: "threads", text: "Frage an die Community", tone: "from-zinc-200 to-neutral-100" },
];
const DRAFT = "Herbst-Aktion: 20 % auf alles";

/**
 * The story the mock plays, one step after another: open the composer, pick two channels, write the text,
 * take the suggested time, schedule it (the draft flies into Thursday), then Wednesday's post goes out.
 * `at` names the element the cursor travels to; `click` marks steps that start with a click where the cursor already is.
 */
const STEPS: { ms: number; at: string; click?: boolean }[] = [
  { ms: 900, at: "rest" },
  { ms: 800, at: "add" },
  { ms: 450, at: "add", click: true },
  { ms: 700, at: "ig" },
  { ms: 600, at: "li", click: true },
  { ms: 1500, at: "text", click: true },
  { ms: 750, at: "time" },
  { ms: 750, at: "plan", click: true },
  { ms: 1300, at: "thu", click: true },
  { ms: 1500, at: "rest" },
  { ms: 1800, at: "rest" },
];
const S = { add: 2, ig: 4, li: 5, type: 5, time: 7, plan: 8, publish: 9, done: 10 } as const;

export function HeroMock() {
  const ready = useReady();
  const frame = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(false);
  const [still, setStill] = useState(false);
  const [typed, setTyped] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0, ok: false });
  const [ripple, setRipple] = useState({ x: 0, y: 0, k: -1 });
  const last = useRef(pos);
  last.current = pos;

  // play only while visible; reduced motion shows the finished state without a cursor
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStill(true);
      setStep(S.done);
      setTyped(DRAFT.length);
      return;
    }
    const el = frame.current;
    if (!el) return;
    let seen = false;
    const io = new IntersectionObserver(([e]) => {
      seen = e.isIntersecting;
      setRun(seen && !document.hidden);
    });
    io.observe(el);
    const vis = () => setRun(seen && !document.hidden);
    document.addEventListener("visibilitychange", vis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  useEffect(() => {
    if (!run || !ready) return;
    const id = window.setTimeout(() => setStep((s) => (s + 1) % STEPS.length), step === 0 && !pos.ok ? 1800 : STEPS[step].ms);
    return () => window.clearTimeout(id);
  }, [run, ready, step, pos.ok]);

  // typing runs inside its step; outside it the draft is either empty or complete
  useEffect(() => {
    if (still) return;
    if (step < S.type) return setTyped(0);
    if (step > S.type) return setTyped(DRAFT.length);
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setTyped(n);
      if (n >= DRAFT.length) window.clearInterval(id);
    }, (STEPS[S.type].ms - 250) / DRAFT.length);
    return () => window.clearInterval(id);
  }, [step, still]);

  // cursor target: measured from the real element, so it stays right at every width
  useLayoutEffect(() => {
    if (still) return;
    // a click happens where the cursor is now, then it travels on
    if (STEPS[step].click) setRipple({ x: last.current.x, y: last.current.y, k: step });
    const measure = () => {
      const root = frame.current;
      const t = root?.querySelector<HTMLElement>(`[data-t="${STEPS[step].at}"]`);
      if (!root || !t) return;
      const a = root.getBoundingClientRect();
      const b = t.getBoundingClientRect();
      setPos({ x: b.left - a.left + b.width * 0.55, y: b.top - a.top + b.height * 0.6, ok: true });
    };
    // wait one frame for elements that are just mounting (composer)
    const raf = requestAnimationFrame(() => requestAnimationFrame(measure));
    return () => cancelAnimationFrame(raf);
  }, [step, still]);

  const open = step >= S.add && step < S.plan;
  const planned = step >= S.plan;
  const publishing = step === S.publish;
  const published = step >= S.done;
  const toast = step === S.plan ? "plan" : published ? "live" : null;

  return (
    <div ref={frame} className="relative overflow-hidden rounded-[28px] bg-surface/80 p-2 shadow-[0_40px_90px_-40px_rgba(16,40,110,0.45)] ring-1 ring-surface sm:p-3">
      <LayoutGroup>
        <div className="flex overflow-hidden rounded-[22px] bg-gradient-to-br from-[var(--mock-a)] via-surface to-[var(--mock-b)] ring-1 ring-line/70">
          {/* rail */}
          <div className="hidden w-[64px] shrink-0 flex-col items-center gap-3 rounded-[20px] bg-[#12141c] py-4 sm:flex" aria-hidden>
            <span className="grid size-9 place-items-center rounded-xl bg-white font-display text-[0.8rem] font-black text-cobalt">P</span>
            <span className={`grid size-9 place-items-center rounded-xl transition-colors duration-300 ${open ? "bg-sky text-white" : "bg-surface text-ink"}`}>
              <Plus className="size-4" />
            </span>
            {[Home, Lightbulb, CalendarDays, MessagesSquare, LineChart].map((I, i) => (
              <span key={i} className={`grid size-9 place-items-center rounded-xl ${i === 2 ? "bg-white/10 text-white" : "text-white/50"}`}>
                <I className="size-4" />
              </span>
            ))}
          </div>

          {/* main */}
          <div className="relative min-w-0 flex-1 p-3 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-left">
                <p className="text-[0.7rem] font-semibold tracking-widest text-ink-3 uppercase">Veröffentlichen</p>
                <p className="font-display text-lg font-bold sm:text-xl">Diese Woche</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden rounded-full bg-surface px-3 py-1.5 text-xs font-semibold shadow-sm ring-1 ring-line sm:inline">Woche</span>
                <motion.span data-t="add" animate={step === S.add ? { scale: [1, 0.92, 1] } : { scale: 1 }} transition={{ duration: 0.3 }} className="inline-flex items-center gap-1 rounded-full bg-cobalt px-3 py-1.5 text-xs font-semibold text-white shadow-[0_10px_22px_-10px_#0047ab]">
                  <Plus className="size-3.5" /> Beitrag
                </motion.span>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1.5 sm:gap-2" data-t="rest">
              {DAYS.map((d, i) => (
                <div key={d} data-t={i === 3 ? "thu" : undefined} className={`h-[190px] overflow-hidden rounded-2xl p-1.5 sm:h-[252px] sm:p-2 ${i === 2 ? "bg-cobalt/[0.07] ring-1 ring-cobalt/20" : "bg-surface/70 ring-1 ring-line"}`}>
                  <p className={`mb-2 text-center text-[0.65rem] font-bold tracking-wide uppercase ${i === 2 ? "text-cobalt-2" : "text-ink-3"}`}>{d}</p>
                  {POSTS.filter((p) => p.day === i).map((p, k) => {
                    const live = p.day === 2;
                    return (
                      <motion.div
                        key={p.text}
                        initial={{ opacity: 0, y: -18, scale: 0.9 }}
                        animate={{ opacity: 1, y: live && publishing ? -3 : 0, scale: 1 }}
                        transition={{ delay: step === 0 && !pos.ok ? 1.3 + i * 0.1 + k * 0.05 : 0, type: "spring", stiffness: 300, damping: 22 }}
                        className={`relative mb-1.5 rounded-xl bg-surface p-1.5 text-left shadow-[0_4px_14px_-8px_rgba(16,40,110,0.4)] ring-1 transition-shadow duration-500 ${live && published ? "ring-2 ring-mint shadow-[0_16px_28px_-14px_rgba(25,195,156,0.8)]" : live && publishing ? "ring-2 ring-sky" : "ring-line"}`}
                      >
                        {(p.day < 2 || (live && published)) && (
                          <motion.span initial={{ scale: live ? 0 : 1 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 420, damping: 18 }} className={`absolute -top-1.5 -right-1.5 z-10 grid place-items-center rounded-full bg-mint text-white ${live ? "size-5 shadow" : "size-3.5"}`}>
                            <Check className={live ? "size-3" : "size-2"} strokeWidth={3.5} />
                          </motion.span>
                        )}
                        <span className="flex items-center gap-1 text-[0.6rem] font-bold">
                          <NetworkIcon platform={p.p} badge size={13} />
                          <span className="hidden sm:inline">{p.time}</span>
                        </span>
                        <span className={`mt-1 block h-10 rounded-lg bg-gradient-to-br sm:h-14 ${p.tone}`} />
                        <span className="mt-1 hidden truncate text-[0.6rem] text-ink-2 sm:block">{p.text}</span>
                        {live && (
                          <span className={`absolute inset-x-1.5 bottom-1 h-[3px] overflow-hidden rounded-full bg-sky/15 transition-opacity duration-300 ${publishing ? "opacity-100" : "opacity-0"}`}>
                            <motion.span className="block h-full origin-left rounded-full bg-sky" initial={false} animate={{ scaleX: publishing ? 1 : 0 }} transition={{ duration: publishing ? 1.3 : 0, ease: "easeInOut" }} />
                          </span>
                        )}
                      </motion.div>
                    );
                  })}
                  {i === 3 && planned && (
                    <motion.div layoutId="draft" className="relative rounded-xl bg-surface p-1.5 text-left shadow-[0_14px_28px_-14px_rgba(0,71,171,0.7)] ring-2 ring-cobalt/70" transition={{ type: "spring", stiffness: 260, damping: 28 }}>
                      <span className="flex items-center gap-1 text-[0.6rem] font-bold">
                        <span className="flex -space-x-1">
                          <NetworkIcon platform="instagram_business" badge size={13} />
                          <NetworkIcon platform="linkedin_page" badge size={13} />
                        </span>
                        <span className="hidden sm:inline">18:00</span>
                      </span>
                      <span className="mt-1 block h-10 rounded-lg bg-gradient-to-br from-amber-200 to-orange-100 sm:h-14" />
                      <span className="mt-1 hidden truncate text-[0.6rem] text-ink-2 sm:block">{DRAFT}</span>
                    </motion.div>
                  )}
                </div>
              ))}
            </div>

            {/* composer */}
            <AnimatePresence>
              {open && (
                <motion.div
                  key="composer"
                  initial={{ opacity: 0, y: 14, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.97, transition: { duration: 0.25 } }}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  className="absolute inset-x-0 top-14 z-20 mx-auto w-[min(360px,92%)] rounded-2xl bg-surface p-3 text-left shadow-[0_30px_70px_-24px_rgba(16,40,110,0.55)] ring-1 ring-line sm:top-16 sm:p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-display text-sm font-bold">Neuer Beitrag</p>
                    <X className="size-4 text-ink-3" />
                  </div>
                  <div className="mt-3 flex items-center gap-1.5">
                    {[
                      ["instagram_business", "ig", step >= S.ig],
                      ["linkedin_page", "li", step >= S.li],
                      ["facebook_page", "fb", false],
                    ].map(([p, t, on]) => (
                      <span key={t as string} data-t={t as string} className={`relative grid size-9 place-items-center rounded-xl transition-all duration-300 ${on ? "bg-cobalt/[0.06] ring-2 ring-cobalt" : "bg-paper opacity-60 ring-1 ring-line"}`}>
                        <NetworkIcon platform={p as string} badge size={20} />
                        {on && (
                          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }} className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-cobalt text-white">
                            <Check className="size-2.5" strokeWidth={3.5} />
                          </motion.span>
                        )}
                      </span>
                    ))}
                    <span className="ml-auto text-[0.65rem] font-medium text-ink-3">{step >= S.li ? "2 Kanäle" : step >= S.ig ? "1 Kanal" : "Kanäle wählen"}</span>
                  </div>
                  <div data-t="text" className={`mt-3 flex gap-2.5 rounded-xl p-2.5 ring-1 transition-colors duration-300 ${step === S.type ? "ring-sky" : "ring-line"}`}>
                    <motion.div layoutId="draft" className="h-12 w-12 shrink-0 rounded-lg bg-gradient-to-br from-amber-200 to-orange-100" transition={{ type: "spring", stiffness: 260, damping: 28 }} />
                    <p className="min-h-[2.5rem] text-xs leading-snug text-ink">
                      {typed === 0 && step < S.type ? <span className="text-ink-3">Was möchtest du teilen?</span> : DRAFT.slice(0, typed)}
                      {step === S.type && <span className="ml-px inline-block h-3.5 w-px translate-y-0.5 animate-pulse bg-ink" />}
                    </p>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span data-t="time" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[0.7rem] font-semibold ring-1 transition-colors duration-300 ${step >= S.time ? "bg-lilac/10 text-lilac ring-lilac/40" : "bg-paper text-ink-2 ring-line"}`}>
                      {step >= S.time ? <Sparkles className="size-3.5" /> : <Clock3 className="size-3.5" />}
                      {step >= S.time ? "Do · 18:00" : "Zeitpunkt"}
                    </span>
                    <ImageIcon className="size-4 text-ink-3" />
                    <span data-t="plan" className={`ml-auto rounded-full px-3.5 py-1.5 text-[0.7rem] font-semibold transition-colors duration-300 ${step >= S.time ? "bg-cobalt text-white" : "bg-cobalt/10 text-cobalt-2"}`}>
                      Planen
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* toast */}
            <div className="pointer-events-none absolute inset-x-0 bottom-1 z-20 flex justify-center sm:bottom-2">
              <AnimatePresence mode="wait">
                {toast && (
                  <motion.span key={toast} initial={{ opacity: 0, y: 14, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }} transition={{ type: "spring", stiffness: 380, damping: 26 }} className="inline-flex items-center gap-2 rounded-full bg-contrast py-1.5 pr-3.5 pl-1.5 text-xs font-semibold text-on-contrast shadow-xl">
                    {toast === "plan" ? (
                      <>
                        <span className="grid size-5 place-items-center rounded-full bg-cobalt-2">
                          <CalendarDays className="size-3" />
                        </span>
                        Eingeplant · Do 18:00
                      </>
                    ) : (
                      <>
                        <NetworkIcon platform="tiktok" badge size={20} />
                        {NETWORK_NAMES.tiktok} · veröffentlicht
                        <Check className="size-3.5 text-mint" strokeWidth={3} />
                      </>
                    )}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* right panel */}
          <div className="hidden w-[220px] shrink-0 flex-col gap-3 p-4 lg:flex" aria-hidden>
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.5, ease: EASE, duration: 0.6 }} className="rounded-2xl bg-cobalt p-3 text-left text-white shadow-sm">
              <p className="text-[0.7rem] font-semibold opacity-80">Geplant · 7 Tage</p>
              <p className="relative h-8 overflow-hidden font-display text-2xl font-bold">
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span key={planned ? 13 : 12} className="absolute inset-0" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -24, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 30 }}>
                    {planned ? 13 : 12}
                  </motion.span>
                </AnimatePresence>
              </p>
            </motion.div>
            {[
              ["Kommentare offen", "4"],
              ["Kanäle verbunden", "6"],
            ].map(([l, v], i) => (
              <motion.div key={l} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.62 + i * 0.12, ease: EASE, duration: 0.6 }} className="rounded-2xl bg-surface p-3 text-left shadow-sm ring-1 ring-line">
                <p className="text-[0.7rem] font-semibold text-ink-3">{l}</p>
                <p className="font-display text-2xl font-bold">{v}</p>
              </motion.div>
            ))}
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.9, ease: EASE, duration: 0.6 }} className={`rounded-2xl bg-gradient-to-br from-lilac to-cobalt-2 p-3 text-left text-white transition-shadow duration-500 ${step === S.time - 1 || step === S.time ? "shadow-[0_0_0_3px_rgba(124,108,240,0.35),0_18px_36px_-16px_rgba(124,108,240,0.9)]" : ""}`}>
              <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold">
                <Sparkles className="size-3.5" /> KI-Vorschlag
              </p>
              <p className="mt-1 text-xs leading-snug opacity-90">„Teste den Beitrag am Donnerstag um 18 Uhr.“</p>
            </motion.div>
          </div>
        </div>
      </LayoutGroup>

      {/* click ripple + cursor */}
      {!still && ripple.k >= 0 && (
        <motion.span key={ripple.k} aria-hidden className="pointer-events-none absolute top-0 left-0 z-30 hidden size-9 rounded-full bg-sky/35 sm:block" style={{ x: ripple.x - 18, y: ripple.y - 18 }} initial={{ scale: 0.2, opacity: 0.9 }} animate={{ scale: 1.5, opacity: 0 }} transition={{ duration: 0.55, ease: "easeOut" }} />
      )}
      {!still && (
        <motion.div aria-hidden className="pointer-events-none absolute top-0 left-0 z-30 hidden sm:block" initial={false} animate={{ x: pos.x, y: pos.y, opacity: pos.ok ? 1 : 0 }} transition={{ x: { duration: 0.7, ease: EASE }, y: { duration: 0.7, ease: EASE }, opacity: { duration: 0.3 } }}>
          <motion.span key={`c${step}`} className="block" initial={{ scale: STEPS[step].click ? 0.82 : 1 }} animate={{ scale: 1 }} transition={{ duration: 0.25 }}>
            <MousePointer2 className="size-6 fill-[#0b1020] text-white drop-shadow-[0_4px_6px_rgba(0,0,0,0.25)]" />
          </motion.span>
        </motion.div>
      )}
    </div>
  );
}
