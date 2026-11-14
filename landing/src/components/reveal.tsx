"use client";
import { motion } from "motion/react";
import type { ReactNode } from "react";

/** Fades + lifts its children once they scroll into view. */
export function Reveal({ children, delay = 0, y = 28, className = "", as = "div" }: { children: ReactNode; delay?: number; y?: number; className?: string; as?: "div" | "li" }) {
  const M = as === "li" ? motion.li : motion.div;
  return (
    <M className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay }}>
      {children}
    </M>
  );
}

const EASE = [0.16, 1, 0.3, 1] as const;

/** Short section label: a glass chip that wipes open, a breathing live dot and a light sweeping across the text. */
export function Eyebrow({ text, light = false }: { text: string; light?: boolean }) {
  return (
    <motion.p
      initial={{ opacity: 0, clipPath: "inset(0 100% 0 0 round 999px)", y: 6 }}
      whileInView={{ opacity: 1, clipPath: "inset(0 0% 0 0 round 999px)", y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.9, ease: EASE }}
      className={`eyebrow-chip inline-flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-2.5 text-[0.7rem] font-bold tracking-[0.2em] uppercase ${light ? "is-light" : ""}`}
    >
      <span aria-hidden className="eyebrow-dot relative grid size-2 place-items-center">
        <span className="absolute inset-0 rounded-full" />
        <span className="relative size-2 rounded-full" />
      </span>
      <span className="eyebrow-text">{text}</span>
    </motion.p>
  );
}

/** Section eyebrow + headline + lead, centred. */
export function SectionHead({ eyebrow, title, lead, light = false }: { eyebrow: string; title: ReactNode; lead?: string; light?: boolean }) {
  return (
    <Reveal className="mx-auto max-w-3xl text-center">
      <Eyebrow text={eyebrow} light={light} />
      <h2 className={`mt-4 font-display text-[clamp(2rem,4.6vw,3.6rem)] leading-[1.02] font-bold tracking-[-0.03em] ${light ? "text-white" : ""}`}>{title}</h2>
      {lead && <p className={`mx-auto mt-5 max-w-2xl text-lg leading-relaxed ${light ? "text-white/70" : "text-ink-2"}`}>{lead}</p>}
    </Reveal>
  );
}
