"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus } from "lucide-react";
import { Reveal, SectionHead } from "./reveal";
import { FAQ } from "@/lib/faq";


export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="relative px-4 py-14 sm:py-20">
      <SectionHead eyebrow="FAQ" title="Häufige Fragen" />
      <Reveal className="mx-auto mt-8 max-w-3xl">
        <ul className="space-y-3">
          {FAQ.map(([q, a], i) => {
            const isOpen = open === i;
            return (
              <li key={q} className={`overflow-hidden rounded-3xl transition-colors ${isOpen ? "bg-white shadow-[0_20px_50px_-30px_rgba(16,40,110,0.4)] ring-1 ring-line" : "bg-white/60 ring-1 ring-line/70"}`}>
                <h3>
                  <button onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen} aria-controls={`faq-${i}`} className="flex min-h-14 w-full items-center justify-between gap-4 px-6 py-4 text-left font-display text-lg font-semibold">
                    {q}
                    <motion.span animate={{ rotate: isOpen ? 45 : 0 }} transition={{ type: "spring", stiffness: 300, damping: 20 }} className={`grid size-8 shrink-0 place-items-center rounded-full ${isOpen ? "bg-cobalt text-white" : "bg-paper"}`}>
                      <Plus className="size-4" />
                    </motion.span>
                  </button>
                </h3>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div id={`faq-${i}`} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
                      <p className="px-6 pb-6 leading-relaxed text-ink-2">{a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </Reveal>
    </section>
  );
}
