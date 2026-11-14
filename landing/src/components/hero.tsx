"use client";
import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { useTick } from "@/lib/use-tick";
import { ArrowRight, Check, CalendarDays, Home, Lightbulb, LineChart, MessagesSquare, MousePointer2, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { NETWORK_NAMES, NetworkIcon } from "./network-icon";
import { REGISTER_URL } from "@/lib/site";

const EASE = [0.16, 1, 0.3, 1] as const;
const WORDS = ["Ein", "Plan.", "Alle", "Kanäle.", "Immer", "sichtbar."];
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
const FLOAT: { p: string; x: string; y: string; d: number; s: number }[] = [
  { p: "instagram_business", x: "-4%", y: "8%", d: 18, s: 54 },
  { p: "tiktok", x: "96%", y: "4%", d: -22, s: 48 },
  { p: "linkedin_page", x: "-6%", y: "62%", d: -14, s: 46 },
  { p: "youtube", x: "97%", y: "58%", d: 20, s: 52 },
  { p: "facebook_page", x: "14%", y: "-9%", d: 10, s: 40 },
  { p: "pinterest", x: "80%", y: "-8%", d: -12, s: 40 },
];

function FloatBadge({ f, i, sx, sy }: { f: (typeof FLOAT)[number]; i: number; sx: MotionValue<number>; sy: MotionValue<number> }) {
  const x = useTransform(sx, [-0.5, 0.5], [-f.d, f.d]);
  const y = useTransform(sy, [-0.5, 0.5], [-f.d, f.d]);
  return (
    <motion.span className="absolute z-20 hidden md:block" style={{ left: f.x, top: f.y, x, y }} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.2 + i * 0.08, type: "spring", stiffness: 260, damping: 18 }} aria-hidden>
      <span className="float-slow grid place-items-center rounded-[18px] bg-white shadow-[0_18px_40px_-16px_rgba(16,40,110,0.45)] ring-1 ring-line" style={{ width: f.s + 18, height: f.s + 18, animationDelay: `${i * -1.1}s` }}>
        <NetworkIcon platform={f.p} badge size={f.s} />
      </span>
    </motion.span>
  );
}

export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 80, damping: 20 });
  const sy = useSpring(my, { stiffness: 80, damping: 20 });
  const rotX = useTransform(sy, [-0.5, 0.5], [6, -6]);
  const rotY = useTransform(sx, [-0.5, 0.5], [-8, 8]);
  // live loop: every 2.4s the next post "goes out" (illustration)
  const tick = useTick(2400);
  const live = POSTS[tick % POSTS.length];
  useEffect(() => {
    const on = (e: PointerEvent) => {
      mx.set(e.clientX / window.innerWidth - 0.5);
      my.set(e.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener("pointermove", on);
    return () => window.removeEventListener("pointermove", on);
  }, [mx, my]);

  return (
    <section id="top" className="relative overflow-hidden pt-32 pb-10 sm:pt-40">
      <div className="aurora soft" aria-hidden>
        <i />
        <i />
        <i />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 text-center">
        <motion.a
          href="#netzwerke"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="glass inline-flex items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5 text-xs font-semibold text-ink-2"
        >
          <span className="flex -space-x-1.5">
            {["instagram_business", "linkedin_page", "tiktok"].map((p) => (
              <NetworkIcon key={p} platform={p} badge size={22} />
            ))}
          </span>
          Über die offiziellen Schnittstellen der Netzwerke
          <ArrowRight className="size-3.5" />
        </motion.a>

        <h1 className="mx-auto mt-7 max-w-4xl font-display text-[clamp(2.6rem,7vw,5.6rem)] leading-[0.98] font-bold tracking-[-0.035em]">
          {WORDS.map((w, i) => (
            <motion.span key={i} className={`mr-[0.22em] inline-block ${i >= 4 ? "shine" : ""}`} initial={{ opacity: 0, y: 40, filter: "blur(10px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.8, ease: EASE, delay: 0.1 + i * 0.08 }}>
              {w}
            </motion.span>
          ))}
        </h1>
        <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.6 }} className="mx-auto mt-6 max-w-2xl text-[clamp(1rem,1.6vw,1.2rem)] leading-relaxed text-ink-2">
          Postfino plant, prüft und veröffentlicht deine Beiträge für Instagram, Facebook, LinkedIn, TikTok, YouTube und mehr – mit Kalender, Ideen-Board, Community-Postfach und Freigaben im Team.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.75 }} className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a href={REGISTER_URL} className="group inline-flex items-center gap-2 rounded-full bg-cobalt px-7 py-4 text-base font-semibold text-white shadow-[0_18px_40px_-16px_#0047ab] transition-transform hover:-translate-y-0.5">
            Jetzt starten
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </a>
          <a href="#so-gehts" className="glass inline-flex items-center gap-2 rounded-full px-7 py-4 text-base font-semibold text-ink transition-transform hover:-translate-y-0.5">
            So funktioniert's
          </a>
        </motion.div>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs font-medium text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-cobalt-2" /> Zugangsdaten verschlüsselt gespeichert
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-cobalt-2" /> Datenbank in Frankfurt (EU)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-cobalt-2" /> Keine Passwörter der Netzwerke
          </span>
        </motion.p>
      </div>

      {/* ── product mock ── */}
      <div ref={ref} className="relative mx-auto mt-16 max-w-6xl px-4 [perspective:1600px]">
        <motion.div initial={{ opacity: 0, y: 80, rotateX: 18 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ duration: 1.2, ease: EASE, delay: 0.5 }} style={{ rotateX: rotX, rotateY: rotY }} className="relative [transform-style:preserve-3d]">
          {FLOAT.map((f, i) => (
            <FloatBadge key={f.p} f={f} i={i} sx={sx} sy={sy} />
          ))}

          <div className="glass relative overflow-hidden rounded-[28px] p-2 sm:p-3">
            <div className="flex overflow-hidden rounded-[22px] bg-gradient-to-br from-[#eef3ff] via-white to-[#f3efff]">
              {/* rail */}
              <div className="hidden w-[64px] shrink-0 flex-col items-center gap-3 rounded-[20px] bg-[#12141c] py-4 sm:flex" aria-hidden>
                <span className="grid size-9 place-items-center rounded-xl bg-white text-[0.7rem] font-black text-ink">B</span>
                <span className="grid size-9 place-items-center rounded-xl bg-white text-ink">
                  <Plus className="size-4" />
                </span>
                {[Home, Lightbulb, CalendarDays, MessagesSquare, LineChart].map((I, i) => (
                  <span key={i} className={`grid size-9 place-items-center rounded-xl ${i === 2 ? "bg-sky text-white" : "text-white/60"}`}>
                    <I className="size-4" />
                  </span>
                ))}
              </div>
              {/* main */}
              <div className="min-w-0 flex-1 p-3 sm:p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-left">
                    <p className="text-[0.7rem] font-semibold tracking-widest text-ink-3 uppercase">Veröffentlichen</p>
                    <p className="font-display text-lg font-bold sm:text-xl">Diese Woche</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="hidden rounded-full bg-white px-3 py-1.5 text-xs font-semibold shadow-sm ring-1 ring-line sm:inline">Woche</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-cobalt px-3 py-1.5 text-xs font-semibold text-white">
                      <Plus className="size-3.5" /> Beitrag
                    </span>
                  </div>
                </div>
                <div className="relative grid grid-cols-7 gap-1.5 sm:gap-2">
                  {DAYS.map((d, i) => (
                    <div key={d} className={`min-h-[190px] rounded-2xl p-1.5 sm:min-h-[230px] sm:p-2 ${i === 2 ? "bg-cobalt/[0.07] ring-1 ring-cobalt/20" : "bg-white/70 ring-1 ring-line"}`}>
                      <p className={`mb-2 text-center text-[0.65rem] font-bold tracking-wide uppercase ${i === 2 ? "text-cobalt-2" : "text-ink-3"}`}>{d}</p>
                      {POSTS.filter((p) => p.day === i).map((p, k) => (
                        <motion.div
                          key={p.text}
                          initial={{ opacity: 0, y: -18, scale: 0.9 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ delay: 1.3 + i * 0.12 + k * 0.05, type: "spring", stiffness: 300, damping: 20 }}
                          className={`relative mb-1.5 rounded-xl bg-white p-1.5 text-left shadow-[0_4px_14px_-8px_rgba(16,40,110,0.4)] ring-1 transition-[box-shadow,transform] duration-500 ${live === p ? "-translate-y-1 shadow-[0_18px_30px_-12px_rgba(25,195,156,0.7)] ring-2 ring-mint" : "ring-line"}`}
                        >
                          <AnimatePresence>
                            {live === p && (
                              <motion.span initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 420, damping: 18 }} className="absolute -top-2 -right-2 z-10 grid size-5 place-items-center rounded-full bg-mint text-white shadow">
                                <Check className="size-3" strokeWidth={3.5} />
                              </motion.span>
                            )}
                          </AnimatePresence>
                          <span className="flex items-center gap-1 text-[0.6rem] font-bold">
                            <NetworkIcon platform={p.p} badge size={13} />
                            <span className="hidden sm:inline">{p.time}</span>
                          </span>
                          <span className={`mt-1 block h-10 rounded-lg bg-gradient-to-br sm:h-14 ${p.tone}`} />
                          <span className="mt-1 hidden truncate text-[0.6rem] text-ink-2 sm:block">{p.text}</span>
                        </motion.div>
                      ))}
                    </div>
                  ))}
                  {/* publish toast */}
                  <div className="pointer-events-none absolute inset-x-0 -bottom-4 z-20 flex justify-center">
                    <AnimatePresence mode="wait">
                      <motion.span key={tick} initial={{ opacity: 0, y: 14, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ type: "spring", stiffness: 380, damping: 26 }} className="inline-flex items-center gap-2 rounded-full bg-ink py-1.5 pr-3.5 pl-1.5 text-xs font-semibold text-white shadow-xl">
                        <NetworkIcon platform={live.p} badge size={20} />
                        {NETWORK_NAMES[live.p]} · veröffentlicht
                        <Check className="size-3.5 text-mint" strokeWidth={3} />
                      </motion.span>
                    </AnimatePresence>
                  </div>
                  {/* drag demo: a card travels from Sa to So, the cursor follows */}
                  <motion.div
                    className="pointer-events-none absolute z-10 hidden w-[12.5%] sm:block"
                    style={{ top: 120 }}
                    initial={{ left: "73%", opacity: 0 }}
                    animate={{ left: ["73%", "73%", "87%", "87%", "73%"], opacity: [0, 1, 1, 1, 0], rotate: [0, -4, -4, 0, 0] }}
                    transition={{ duration: 5, times: [0, 0.15, 0.55, 0.8, 1], repeat: Infinity, repeatDelay: 1.5, delay: 2.8, ease: "easeInOut" }}
                    aria-hidden
                  >
                    <div className="rounded-xl bg-white p-1.5 shadow-[0_18px_40px_-14px_rgba(16,40,110,0.6)] ring-2 ring-sky">
                      <span className="flex items-center gap-1 text-[0.6rem] font-bold">
                        <NetworkIcon platform="instagram_business" badge size={13} /> 19:00
                      </span>
                      <span className="mt-1 block h-14 rounded-lg bg-gradient-to-br from-violet-200 to-fuchsia-100" />
                    </div>
                    <MousePointer2 className="absolute -right-3 -bottom-3 size-6 fill-ink text-white drop-shadow" />
                  </motion.div>
                </div>
              </div>
              {/* right panel */}
              <div className="hidden w-[220px] shrink-0 flex-col gap-3 p-4 lg:flex" aria-hidden>
                {[
                  ["Geplant · 7 Tage", "12", "bg-cobalt text-white"],
                  ["Kommentare offen", "4", "bg-white"],
                  ["Kanäle verbunden", "6", "bg-white"],
                ].map(([l, v, c], i) => (
                  <motion.div key={l} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.5 + i * 0.12, ease: EASE, duration: 0.6 }} className={`rounded-2xl p-3 text-left shadow-sm ring-1 ring-line ${c}`}>
                    <p className="text-[0.7rem] font-semibold opacity-80">{l}</p>
                    <p className="font-display text-2xl font-bold">{v}</p>
                  </motion.div>
                ))}
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.9, ease: EASE, duration: 0.6 }} className="rounded-2xl bg-gradient-to-br from-lilac to-cobalt-2 p-3 text-left text-white">
                  <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold">
                    <Sparkles className="size-3.5" /> KI-Vorschlag
                  </p>
                  <p className="mt-1 text-xs leading-snug opacity-90">„Teste den Beitrag am Donnerstag um 18 Uhr.“</p>
                </motion.div>
              </div>
            </div>
          </div>
        </motion.div>
        <p className="mt-4 text-center text-xs text-ink-3">Illustration der Anwendung – Inhalte sind Beispiele.</p>
      </div>
    </section>
  );
}
