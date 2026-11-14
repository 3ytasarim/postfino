"use client";
import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { CalendarCheck2, Link2, MailCheck } from "lucide-react";
import { Reveal, SectionHead } from "./reveal";

const STEPS = [
  { icon: MailCheck, title: "Konto erstellen", text: "Name, E-Mail, Passwort – und den 6-stelligen Code aus deinem Postfach eingeben. Fertig." },
  { icon: Link2, title: "Kanäle verbinden", text: "Klick auf ein Netzwerk, Anmeldung im offiziellen Fenster des Netzwerks, Zugriff bestätigen. Wir sehen dein Passwort nie." },
  { icon: CalendarCheck2, title: "Planen & veröffentlichen", text: "Beitrag schreiben, Kanäle wählen, Zeit festlegen. Postfino veröffentlicht pünktlich und meldet, wenn etwas hakt." },
];

/** Three steps on a dark band; a line fills as you scroll. */
export function Steps() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 55%"] });
  const scaleX = useTransform(scrollYProgress, [0, 1], [0, 1]);
  return (
    <section id="so-gehts" className="relative overflow-hidden bg-[#070d24] px-4 py-14 text-white sm:py-20">
      <div className="aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="relative">
        <SectionHead light eyebrow="So geht's" title="In drei Schritten startklar." lead="Keine Installation, keine Kreditkarte für die Registrierung. Du brauchst nur deine E-Mail-Adresse und Zugang zu deinen Kanälen." />
        <div ref={ref} className="relative mx-auto mt-10 max-w-6xl">
          <div className="absolute top-[34px] right-[16%] left-[16%] hidden h-px bg-white/15 md:block" aria-hidden>
            <motion.div style={{ scaleX }} className="h-full origin-left bg-gradient-to-r from-sky to-lilac" />
          </div>
          <ol className="grid gap-5 md:grid-cols-3">
            {STEPS.map(({ icon: I, title, text }, i) => (
              <Reveal as="li" key={title} delay={i * 0.12} className="glass-dark relative h-full rounded-[28px] p-7 text-center">
                  <span className="relative mx-auto grid size-[68px] place-items-center rounded-full bg-gradient-to-br from-sky to-lilac shadow-[0_0_0_8px_rgba(79,141,255,0.12)]">
                    <span className="ping-ring absolute inset-0 rounded-full bg-sky/40" style={{ animationDelay: `${i * 0.8}s` }} />
                    <I className="relative size-7" />
                    <span className="absolute -top-1 -right-1 grid size-6 place-items-center rounded-full bg-white text-xs font-black text-ink">{i + 1}</span>
                  </span>
                  <h3 className="mt-6 font-display text-xl font-bold">{title}</h3>
                  <p className="mt-2 leading-relaxed text-white/70">{text}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
