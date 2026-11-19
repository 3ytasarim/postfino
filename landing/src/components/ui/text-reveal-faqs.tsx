"use client";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion";

export type FaqItem = { id: string; question: string; answer: string };

export function TextRevealFaqs({
  items,
  title,
  lead,
  contact,
}: {
  items: FaqItem[];
  title: string;
  lead: string;
  /** "Can't find what you're looking for?" line, shown under the lead on desktop and below the list on mobile */
  contact: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl px-6">
      <div className="grid gap-8 md:grid-cols-5 md:gap-12">
        <div className="md:col-span-2">
          <h2 className="font-display text-4xl font-bold tracking-[-0.03em] text-ink">{title}</h2>
          <p className="mt-4 text-lg text-balance text-ink-2">{lead}</p>
          <p className="mt-6 hidden text-ink-2 md:block">{contact}</p>
        </div>

        <div className="md:col-span-3">
          <Accordion type="single" collapsible>
            {items.map((item) => (
              <AccordionItem key={item.id} value={item.id} className="border-b border-line">
                <AccordionTrigger className="cursor-pointer text-base font-medium text-ink hover:no-underline">{item.question}</AccordionTrigger>
                <AccordionContent>
                  <BlurredStagger text={item.answer} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        <p className="mt-6 text-ink-2 md:hidden">{contact}</p>
      </div>
    </div>
  );
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.015 } },
};

const letterAnimation = {
  hidden: { opacity: 0, filter: "blur(10px)" },
  show: { opacity: 1, filter: "blur(0px)" },
};

/** Letters fade in out of a blur one after another. Words stay unbroken; screen readers get the plain text. */
export function BlurredStagger({ text }: { text: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <p className="text-base leading-relaxed text-ink-2">{text}</p>;
  return (
    <div className="w-full">
      <motion.p
        variants={container}
        initial="hidden"
        animate="show"
        aria-label={text}
        className="text-base leading-relaxed break-words whitespace-normal text-ink-2"
      >
        {text.split(" ").map((word, w, words) => (
          <span key={w} aria-hidden className="inline-block whitespace-nowrap">
            {word.split("").map((char, i) => (
              <motion.span key={i} variants={letterAnimation} transition={{ duration: 0.3 }} className="inline-block">
                {char}
              </motion.span>
            ))}
            {w < words.length - 1 && <motion.span variants={letterAnimation} className="inline-block">{" "}</motion.span>}
          </span>
        ))}
      </motion.p>
    </div>
  );
}
