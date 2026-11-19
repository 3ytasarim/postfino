"use client";
import { motion } from "motion/react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { NetworkIcon } from "./network-icon";
import { HeroMock } from "./hero-mock";
import { MadeBy } from "./made-by";
import { REGISTER_URL } from "@/lib/site";

const EASE = [0.16, 1, 0.3, 1] as const;
const WORDS = ["Ein", "Plan.", "Alle", "Kanäle.", "Immer", "sichtbar."];
const FLOAT: { p: string; x: string; y: string; s: number }[] = [
  { p: "instagram_business", x: "-4%", y: "8%", s: 54 },
  { p: "tiktok", x: "96%", y: "4%", s: 48 },
  { p: "linkedin_page", x: "-6%", y: "62%", s: 46 },
  { p: "youtube", x: "97%", y: "58%", s: 52 },
  { p: "facebook_page", x: "14%", y: "-9%", s: 40 },
  { p: "pinterest", x: "80%", y: "-8%", s: 40 },
];

/** Network badge floating around the mock; the bob is a compositor-only CSS transform. */
function FloatBadge({ f, i }: { f: (typeof FLOAT)[number]; i: number }) {
  return (
    <motion.span className="absolute z-20 hidden md:block" style={{ left: f.x, top: f.y }} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.2 + i * 0.08, type: "spring", stiffness: 260, damping: 18 }} aria-hidden>
      <span className="float-slow grid place-items-center rounded-[18px] bg-surface shadow-[0_18px_40px_-16px_rgba(16,40,110,0.45)] ring-1 ring-line" style={{ width: f.s + 18, height: f.s + 18, animationDelay: `${i * -1.1}s` }}>
        <NetworkIcon platform={f.p} badge size={f.s} />
      </span>
    </motion.span>
  );
}

export function Hero() {
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

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 1.15 }} className="mt-7 flex justify-center px-4">
        <MadeBy />
      </motion.div>

      {/* ── product mock ── */}
      <div className="relative mx-auto mt-16 max-w-6xl px-4 [perspective:1600px]">
        <motion.div initial={{ opacity: 0, y: 80, rotateX: 18 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ duration: 1.2, ease: EASE, delay: 0.5 }} className="relative">
          {FLOAT.map((f, i) => (
            <FloatBadge key={f.p} f={f} i={i} />
          ))}

          <HeroMock />
        </motion.div>
        <p className="mt-4 text-center text-xs text-ink-3">Illustration der Anwendung – Inhalte sind Beispiele.</p>
      </div>
    </section>
  );
}
