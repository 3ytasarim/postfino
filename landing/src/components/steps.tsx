"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { CalendarCheck2, Check, Clock3, Link2, Loader2, MailCheck, Send } from "lucide-react";
import { Reveal, SectionHead } from "./reveal";
import { NetworkIcon } from "./network-icon";

const TICK_MS = 450;
const PER_STEP = 12; // ticks each step stays in focus

/** One tick counter for the whole section; runs only while the section is on screen. */
function useWalk() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-80px" });
  const [n, setN] = useState(-1);
  useEffect(() => {
    if (!inView || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => !document.hidden && setN((v) => v + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [inView]);
  return { ref, n };
}

/* ── 1 · account: e-mail typed, code arrives, confirmed ── */
const EMAIL = "lena@studio-nord.de";
const CODE = "482193";
function AccountMock({ s }: { s: number }) {
  const typed = EMAIL.slice(0, Math.round(Math.min(1, s / 3) * EMAIL.length));
  const digits = Math.max(0, Math.min(6, s - 4));
  const done = s >= 11;
  return (
    <div className="flex h-full flex-col justify-center gap-2.5 text-left">
      <div className="rounded-xl bg-surface px-3 py-2 ring-1 ring-line">
        <span className="block text-[0.55rem] font-semibold tracking-wide text-ink-3 uppercase">E-Mail</span>
        <span className="block h-4 font-mono text-[0.72rem] text-ink">
          {typed}
          {s < 3 && <span className="caret ml-px inline-block h-3 w-px translate-y-0.5 bg-cobalt" />}
        </span>
      </div>
      <div className="flex items-center justify-between gap-1">
        {CODE.split("").map((d, i) => (
          <span key={i} className={`grid h-8 flex-1 place-items-center rounded-lg font-mono text-sm font-bold transition-colors duration-300 ${i < digits ? (done ? "bg-mint/15 text-[#0e9f6e] ring-1 ring-mint/40" : "bg-cobalt/10 text-cobalt ring-1 ring-cobalt/25") : "bg-surface ring-1 ring-line"}`}>
            <AnimatePresence>{i < digits && <motion.span initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>{d}</motion.span>}</AnimatePresence>
          </span>
        ))}
      </div>
      <div className="h-5 text-center text-[0.68rem] font-semibold">
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.span key="ok" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1 text-[#0e9f6e]">
              <Check className="size-3.5" /> Konto bestätigt
            </motion.span>
          ) : (
            <motion.span key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1 text-ink-3">
              <MailCheck className="size-3.5" /> {s < 4 ? "Code wird gesendet …" : "Code aus dem Postfach"}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── 2 · channels: networks connect one after another ── */
const NETS: [string, string][] = [
  ["instagram_business", "Instagram"],
  ["linkedin_page", "LinkedIn"],
  ["tiktok", "TikTok"],
];
function ChannelsMock({ s }: { s: number }) {
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      {NETS.map(([p, name], i) => {
        const start = 1 + i * 3.5;
        const state = s >= start + 2 ? "on" : s >= start ? "busy" : "off";
        return (
          <div key={p} className={`flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 ring-1 transition-colors duration-300 ${state === "on" ? "bg-surface ring-mint/40" : state === "busy" ? "bg-surface ring-cobalt/30" : "bg-surface/60 ring-line"}`}>
            <NetworkIcon platform={p} badge size={22} />
            <span className="text-[0.72rem] font-semibold text-ink">{name}</span>
            <span className="ml-auto text-[0.62rem] font-semibold">
              <AnimatePresence mode="wait" initial={false}>
                {state === "on" ? (
                  <motion.span key="on" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="inline-flex items-center gap-1 rounded-full bg-mint/15 px-2 py-0.5 text-[#0e9f6e]">
                    <Check className="size-3" /> Verbunden
                  </motion.span>
                ) : state === "busy" ? (
                  <motion.span key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1 text-cobalt">
                    <Loader2 className="size-3 animate-spin" /> Anmelden …
                  </motion.span>
                ) : (
                  <motion.span key="off" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-full bg-cobalt px-2 py-0.5 text-[#fff]">
                    Verbinden
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── 3 · plan: text typed, time chosen, planned, published ── */
const POST = "Neue Herbstkollektion ist online!";
function PlanMock({ s }: { s: number }) {
  const typed = POST.slice(0, Math.round(Math.min(1, s / 4) * POST.length));
  const timed = s >= 5;
  const status = s >= 9 ? "live" : s >= 7 ? "planned" : "draft";
  return (
    <div className="flex h-full flex-col justify-center gap-2 text-left">
      <div className="rounded-xl bg-surface p-2.5 ring-1 ring-line">
        <div className="flex items-center gap-1">
          {["instagram_business", "facebook_page", "linkedin_page"].map((p) => (
            <NetworkIcon key={p} platform={p} badge size={16} />
          ))}
          <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.58rem] font-semibold transition-colors duration-300 ${timed ? "bg-cobalt/10 text-cobalt" : "bg-ink/5 text-ink-3"}`}>
            <Clock3 className="size-2.5" /> {timed ? "Do · 18:00" : "Zeitpunkt"}
          </span>
        </div>
        <p className="mt-1.5 h-4 truncate text-[0.72rem] text-ink">
          {typed}
          {s < 4 && <span className="caret ml-px inline-block h-3 w-px translate-y-0.5 bg-cobalt" />}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <motion.span animate={{ scale: s === 6 ? 0.94 : 1 }} className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#0047ab] to-[#007bff] px-3 py-1 text-[0.65rem] font-bold text-[#fff] shadow-[0_8px_18px_-8px_#007bff]">
          <Send className="size-3" /> Planen
        </motion.span>
        <span className="ml-auto text-[0.65rem] font-semibold">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={status} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className={`inline-flex items-center gap-1 ${status === "live" ? "text-[#0e9f6e]" : status === "planned" ? "text-cobalt" : "text-ink-3"}`}>
              {status === "live" ? <Check className="size-3.5" /> : <CalendarCheck2 className="size-3.5" />}
              {status === "live" ? "Veröffentlicht" : status === "planned" ? "Geplant" : "Entwurf"}
            </motion.span>
          </AnimatePresence>
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-ink/10">
        <span className="block h-full origin-left rounded-full bg-gradient-to-r from-sky to-mint transition-transform ease-linear" style={{ transform: `scaleX(${status === "live" ? 1 : status === "planned" ? (s - 7) / 2 : 0})`, transitionDuration: `${TICK_MS}ms` }} />
      </div>
    </div>
  );
}

const STEPS: { icon: typeof MailCheck; title: string; text: string; mock: (s: number) => ReactNode }[] = [
  { icon: MailCheck, title: "Konto erstellen", text: "Name, E-Mail, Passwort – und den 6-stelligen Code aus deinem Postfach eingeben. Fertig.", mock: (s) => <AccountMock s={s} /> },
  { icon: Link2, title: "Kanäle verbinden", text: "Klick auf ein Netzwerk, Anmeldung im offiziellen Fenster des Netzwerks, Zugriff bestätigen. Wir sehen dein Passwort nie.", mock: (s) => <ChannelsMock s={s} /> },
  { icon: CalendarCheck2, title: "Planen & veröffentlichen", text: "Beitrag schreiben, Kanäle wählen, Zeit festlegen. Postfino veröffentlicht pünktlich und meldet, wenn etwas hakt.", mock: (s) => <PlanMock s={s} /> },
];

/** Three steps played one after another: the focused card runs its mini story, the line walks to the next. */
export function Steps() {
  const { ref, n } = useWalk();
  const active = n < 0 ? -1 : Math.floor(n / PER_STEP) % STEPS.length;
  const local = n < 0 ? PER_STEP : n % PER_STEP;
  const progress = active < 0 ? 1 : Math.min(1, (active + local / PER_STEP) / (STEPS.length - 1));
  return (
    <section id="so-gehts" className="steps-band relative overflow-hidden px-4 py-14 sm:py-20">
      <div className="aurora hidden dark:block" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="relative">
        <SectionHead eyebrow="So geht's" title="In drei Schritten startklar." lead="Keine Installation, keine Kreditkarte für die Registrierung. Du brauchst nur deine E-Mail-Adresse und Zugang zu deinen Kanälen." />
        <div ref={ref} className="relative mx-auto mt-12 max-w-6xl">
          <div className="absolute top-[-18px] right-[16%] left-[16%] hidden h-[3px] rounded-full bg-ink/10 md:block" aria-hidden>
            <span className="block h-full origin-left rounded-full bg-gradient-to-r from-[#0047ab] via-[#007bff] to-lilac transition-transform ease-linear" style={{ transform: `scaleX(${progress})`, transitionDuration: `${TICK_MS}ms` }} />
          </div>
          <ol className="grid gap-5 md:grid-cols-3">
            {STEPS.map(({ icon: I, title, text, mock }, i) => {
              const on = i === active;
              return (
                <Reveal as="li" key={title} delay={i * 0.12} className="h-full">
                  <div className={`relative h-full rounded-[28px] bg-surface/85 p-3 shadow-[0_24px_50px_-30px_rgba(16,40,110,0.45)] ring-1 transition-[transform,box-shadow] duration-500 ${on ? "-translate-y-1.5 shadow-[0_30px_60px_-28px_rgba(0,71,171,0.55)] ring-cobalt/35" : "ring-line"}`}>
                    <span className={`absolute -top-[30px] left-1/2 hidden size-6 -translate-x-1/2 place-items-center rounded-full text-xs font-black transition-colors duration-300 md:grid ${i <= active || active < 0 ? "bg-gradient-to-br from-[#0047ab] to-[#007bff] text-[#fff] shadow-[0_0_0_5px_rgba(0,123,255,0.15)]" : "bg-surface text-ink-3 ring-1 ring-line"}`}>{i + 1}</span>
                    <div className="h-[168px] rounded-[20px] bg-gradient-to-b from-[var(--mock-a)] to-surface p-4 ring-1 ring-line">{mock(on ? local : PER_STEP)}</div>
                    <div className="px-4 pt-5 pb-4">
                      <div className="flex items-center gap-3">
                        <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#0047ab] to-[#007bff] text-[#fff] shadow-[0_10px_22px_-10px_#007bff]">
                          {on && <span className="ping-ring absolute inset-0 rounded-xl bg-[#007bff]/40" />}
                          <I className="relative size-5" />
                        </span>
                        <h3 className="font-display text-lg font-bold text-ink">
                          <span className="mr-1.5 text-ink-3 md:hidden">{i + 1}.</span>
                          {title}
                        </h3>
                      </div>
                      <p className="mt-3 leading-relaxed text-ink-2">{text}</p>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
