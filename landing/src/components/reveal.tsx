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

/** Section eyebrow + headline + lead, centred. */
export function SectionHead({ eyebrow, title, lead, light = false }: { eyebrow: string; title: ReactNode; lead?: string; light?: boolean }) {
  return (
    <Reveal className="mx-auto max-w-3xl text-center">
      <p className={`text-xs font-bold tracking-[0.22em] uppercase ${light ? "text-sky" : "text-cobalt-2"}`}>{eyebrow}</p>
      <h2 className={`mt-4 font-display text-[clamp(2rem,4.6vw,3.6rem)] leading-[1.02] font-bold tracking-[-0.03em] ${light ? "text-white" : ""}`}>{title}</h2>
      {lead && <p className={`mx-auto mt-5 max-w-2xl text-lg leading-relaxed ${light ? "text-white/70" : "text-ink-2"}`}>{lead}</p>}
    </Reveal>
  );
}
