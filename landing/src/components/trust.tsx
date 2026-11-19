"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { Check, Database, KeyRound, Lock, MailCheck, MapPin, ShieldCheck, Smartphone } from "lucide-react";
import { Reveal, SectionHead } from "./reveal";
import { NETWORK_NAMES, NetworkIcon } from "./network-icon";

const STEP_MS = 1200;

/** One shared beat for all six visuals; it only runs while the section is on screen. */
function useBeat() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-60px" });
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!inView || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => !document.hidden && setT((v) => v + 1), STEP_MS);
    return () => window.clearInterval(id);
  }, [inView]);
  return { ref, t };
}

/* ── 1 · official sign-in: Postfino ↔ network, consent, connected ── */
const OAUTH_NETS = ["instagram_business", "linkedin_page", "tiktok"];
function OAuthVisual({ t }: { t: number }) {
  const net = OAUTH_NETS[Math.floor(t / 3) % OAUTH_NETS.length];
  const phase = t % 3;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-2xl bg-white ring-1 ring-line font-display text-base font-black text-[#0047ab] shadow-[0_10px_24px_-10px_rgba(79,141,255,0.8)]">P</span>
        <span className="relative h-px w-16 bg-ink/15">
          <span className={`absolute inset-0 origin-left bg-gradient-to-r from-sky to-mint transition-transform duration-700 ${phase === 2 ? "scale-x-100" : "scale-x-0"}`} />
          {phase === 0 && <span className="trust-dot absolute -top-[3px] size-[7px] rounded-full bg-sky shadow-[0_0_10px_2px_rgba(79,141,255,0.8)]" />}
        </span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={net} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 24 }} className="grid size-11 place-items-center rounded-2xl bg-surface ring-1 ring-line">
            <NetworkIcon platform={net} badge size={28} />
          </motion.span>
        </AnimatePresence>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={`${net}${phase}`} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -6, opacity: 0 }} transition={{ duration: 0.25 }} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.7rem] font-semibold ${phase === 0 ? "bg-ink/[0.06] text-ink-2" : phase === 1 ? "bg-cobalt text-[#fff]" : "bg-mint/15 text-mint"}`}>
          {phase === 0 ? `Mit ${NETWORK_NAMES[net]} anmelden …` : phase === 1 ? "Zugriff erlauben" : (
            <>
              <Check className="size-3.5" strokeWidth={3} /> Verbunden
            </>
          )}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/* ── 2 · tokens: readable once, stored as cipher text ── */
const HEX = "0123456789abcdef";
function cipher(seed: number, n: number) {
  let s = "";
  let x = seed * 9301 + 49297;
  for (let i = 0; i < n; i++) {
    x = (x * 9301 + 49297) % 233280;
    s += HEX[x % 16];
  }
  return s;
}
function TokenVisual({ t }: { t: number }) {
  const c = cipher(t, 16);
  return (
    <div className="flex h-full flex-col justify-center gap-2 font-mono text-[0.7rem]">
      <div className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-ink-3 ring-1 ring-line">
        <span className="w-[4.6rem] shrink-0 font-sans text-[0.58rem] font-semibold tracking-wider uppercase">Token</span>
        <span className="truncate line-through decoration-ink-3/50">EAAGm0PX8BA7ZCZB…</span>
      </div>
      <div className="flex items-center gap-2 rounded-xl bg-sky/10 px-3 py-2 text-cobalt-2 ring-1 ring-sky/30 dark:text-sky">
        <span className="w-[4.6rem] shrink-0 font-sans text-[0.58rem] font-semibold tracking-wider text-ink-3 uppercase">Gespeichert</span>
        <span className="min-w-0 truncate">
          {c.slice(0, 4)}·{c.slice(4, 8)}·{c.slice(8, 12)}·{c.slice(12)}
        </span>
        <Lock className="ml-auto size-3.5 shrink-0 text-mint" />
      </div>
    </div>
  );
}

/* ── 3 · e-mail code: six digits fill in, then the address is confirmed ── */
const CODE = "482193";
function MailVisual({ t }: { t: number }) {
  const n = t % 9; // 0..6 typing, 7..8 confirmed
  const ok = n >= 7;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="flex gap-1.5">
        {CODE.split("").map((d, i) => (
          <span key={i} className={`grid h-10 w-8 place-items-center rounded-lg font-display text-lg font-bold ring-1 transition-colors duration-300 ${ok ? "bg-mint/15 text-mint ring-mint/40" : i < n ? "bg-ink/[0.06] text-ink ring-line" : i === n ? "bg-surface text-ink ring-sky" : "bg-surface text-transparent ring-line"}`}>
            {i < n || ok ? (
              <motion.span key={`${d}${t - (n - i)}`} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.2 }}>
                {d}
              </motion.span>
            ) : i === n ? (
              <span className="h-4 w-px animate-pulse bg-sky" />
            ) : null}
          </span>
        ))}
      </div>
      <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-semibold transition-colors ${ok ? "text-mint" : "text-ink-3"}`}>
        {ok ? <Check className="size-3.5" strokeWidth={3} /> : <MailCheck className="size-3.5" />}
        {ok ? "E-Mail bestätigt" : "Code aus der E-Mail eingeben"}
      </span>
    </div>
  );
}

/* ── 4 · two-factor: a fresh code with a draining ring every few seconds ── */
const TOTP_STEPS = 5;
function TotpVisual({ t }: { t: number }) {
  const round = Math.floor(t / TOTP_STEPS);
  const code = cipher(round + 7, 6).replace(/[a-f]/g, (ch) => String(HEX.indexOf(ch) - 10));
  return (
    <div className="flex h-full items-center justify-center gap-4">
      <span className="relative grid size-14 place-items-center">
        <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
          <circle cx="20" cy="20" r="17" fill="none" stroke="var(--color-line)" strokeWidth="3" />
          <motion.circle key={round} cx="20" cy="20" r="17" fill="none" stroke="#4f8dff" strokeWidth="3" strokeLinecap="round" initial={{ pathLength: 1 }} animate={{ pathLength: 0 }} transition={{ duration: (TOTP_STEPS * STEP_MS) / 1000, ease: "linear" }} />
        </svg>
        <Smartphone className="size-5 text-ink-2" />
      </span>
      <div>
        <p className="text-[0.6rem] font-semibold tracking-wider text-ink-3 uppercase">Authenticator</p>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p key={round} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28 }} className="font-mono text-2xl font-bold tracking-[0.18em] text-ink">
            {code.slice(0, 3)} {code.slice(3)}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── 5 · data in the EU: ring of twelve stars around Frankfurt ── */
function EuVisual() {
  return (
    <div className="flex h-full items-center justify-center gap-4">
      <span className="relative size-[92px]">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className="absolute top-1/2 left-1/2 text-[0.7rem] leading-none text-[#f2b705] dark:text-[#ffcc00]" style={{ transform: `rotate(${i * 30}deg) translateY(-40px) rotate(${-i * 30}deg) translate(-50%, -50%)` }}>
            ★
          </span>
        ))}
        <span className="absolute inset-0 grid place-items-center">
          <span className="relative grid size-9 place-items-center rounded-full bg-cobalt-2 text-[#fff] shadow-[0_0_24px_4px_rgba(29,91,216,0.55)]">
            <span className="orbit-ping absolute inset-0 rounded-full bg-sky/50" />
            <MapPin className="relative size-4" />
          </span>
        </span>
      </span>
      <div className="text-left">
        <p className="font-display text-lg font-bold text-ink">Frankfurt</p>
        <p className="text-[0.7rem] font-medium text-ink-3">am Main · EU</p>
      </div>
    </div>
  );
}

/* ── 6 · roles: each role gets only what it needs ── */
const ROLES: [string, boolean, boolean, boolean][] = [
  ["Admin", true, true, true],
  ["Redaktion", true, true, false],
  ["Ansicht", false, false, false],
];
function RolesVisual({ t }: { t: number }) {
  // one row per two beats; its switches start closed and flip open one after another
  const on = Math.floor(t / 2) % ROLES.length;
  return (
    <div className="flex h-full flex-col justify-center text-[0.68rem]">
      <div className="mb-1 grid grid-cols-[1fr_repeat(3,3.1rem)] px-2 text-center text-[0.55rem] font-semibold tracking-wide text-ink-3 uppercase">
        <span className="text-left">Rolle</span>
        <span>Planen</span>
        <span>Senden</span>
        <span>Team</span>
      </div>
      {ROLES.map(([name, ...rights], i) => (
        <div key={name} className="relative grid grid-cols-[1fr_repeat(3,3.1rem)] items-center px-2 py-1.5">
          {i === on && <motion.span layoutId="role-row" className="absolute inset-0 rounded-lg bg-ink/[0.05] ring-1 ring-line" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
          <span className={`relative font-semibold transition-colors ${i === on ? "text-ink" : "text-ink-3"}`}>{name}</span>
          {rights.map((r, k) => {
            const open = r && i === on;
            return (
              <span key={k} className="relative grid place-items-center">
                <span className={`flex h-3.5 w-6 items-center rounded-full p-0.5 transition-colors duration-300 ${open ? "bg-mint" : "bg-ink/15"}`} style={{ transitionDelay: open ? `${250 + k * 260}ms` : "0ms" }}>
                  <span className={`size-2.5 rounded-full bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.34,1.5,0.5,1)] ${open ? "translate-x-2.5" : "translate-x-0"}`} style={{ transitionDelay: open ? `${250 + k * 260}ms` : "0ms" }} />
                </span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const ITEMS: { icon: typeof ShieldCheck; title: string; text: string; visual: (t: number) => ReactNode }[] = [
  { icon: ShieldCheck, title: "Offizielle Anmeldung", text: "Kanäle werden über die Login-Fenster der Netzwerke verbunden (OAuth). Deine Passwörter bleiben bei Instagram, LinkedIn & Co.", visual: (t) => <OAuthVisual t={t} /> },
  { icon: Lock, title: "Verschlüsselte Tokens", text: "Zugriffsschlüssel der Netzwerke werden verschlüsselt gespeichert und nur zum Veröffentlichen verwendet.", visual: (t) => <TokenVisual t={t} /> },
  { icon: MailCheck, title: "E-Mail-Bestätigung", text: "Neue Konten bestätigen ihre Adresse mit einem einmaligen 6-stelligen Code.", visual: (t) => <MailVisual t={t} /> },
  { icon: Smartphone, title: "Zwei-Faktor-Schutz", text: "Optional per Authenticator-App absichern, z. B. Microsoft oder Google Authenticator.", visual: (t) => <TotpVisual t={t} /> },
  { icon: Database, title: "Daten in der EU", text: "Die Datenbank liegt in Frankfurt am Main.", visual: () => <EuVisual /> },
  { icon: KeyRound, title: "Rollen & Rechte", text: "Jedes Teammitglied sieht und darf nur, was seine Rolle erlaubt.", visual: (t) => <RolesVisual t={t} /> },
];

export function Trust() {
  const { ref, t } = useBeat();
  return (
    <section className="relative px-3 py-14 sm:px-4 sm:py-20" aria-labelledby="trust-title">
      <div ref={ref} className="relative mx-auto max-w-6xl overflow-hidden trust-panel rounded-[36px] px-4 py-14 sm:rounded-[44px] sm:px-10 sm:py-20">
        {/* soft brand glows, no texture */}
        <span aria-hidden className="pointer-events-none absolute hidden dark:block -top-40 left-1/2 h-80 w-[46rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(29,91,216,0.22),transparent)]" />
        <span aria-hidden className="pointer-events-none absolute hidden dark:block -right-32 -bottom-40 h-96 w-96 rounded-full bg-[radial-gradient(closest-side,rgba(124,108,240,0.28),transparent)]" />

        <div className="relative">
          <SectionHead eyebrow="Sicherheit" title={<span id="trust-title">Deine Kanäle sind bei uns gut aufgehoben.</span>} lead="Postfino verbindet sich nur über die offiziellen Schnittstellen der Netzwerke. Deine Passwörter sehen wir nie." />
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ITEMS.map(({ icon: I, title, text, visual }, i) => (
              <Reveal as="li" key={title} delay={(i % 3) * 0.08} className="group flex flex-col rounded-[26px] bg-surface/80 p-2 shadow-[0_24px_50px_-36px_rgba(16,40,110,0.45)] ring-1 ring-line transition-transform duration-500 hover:-translate-y-1">
                <div aria-hidden className="h-[148px] rounded-[20px] bg-gradient-to-b from-[var(--mock-a)] to-surface px-4 ring-1 ring-line">
                  {visual(t)}
                </div>
                <div className="flex gap-3 p-4 pt-5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-cobalt-2/10 text-cobalt-2 ring-1 ring-cobalt-2/20 dark:bg-cobalt-2/20 dark:text-sky dark:ring-sky/25">
                    <I className="size-[18px]" />
                  </span>
                  <div>
                    <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
                    <p className="mt-1 text-[0.95rem] leading-relaxed text-ink-2">{text}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
