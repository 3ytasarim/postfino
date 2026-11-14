"use client";
import { Check, Flame } from "lucide-react";
import { motion } from "motion/react";
import { SectionHead } from "./reveal";
import { CONTACT_EMAIL, REGISTER_URL } from "@/lib/site";

type Plan = { name: string; price: string; descp: string; items: string[]; featured?: boolean };

// Mirrors the draft plan defaults of the app (packages/shared/src/plans.ts) – not yet a binding offer.
const PLANS: Plan[] = [
  { name: "Starter", price: "19 €", descp: "Für Selbstständige, die ihre eigenen Kanäle planen.", items: ["3 Kanäle", "1 Person", "1 Arbeitsbereich", "Kalender, Ideen & Insights", "100 KI-Vorschläge / Monat"] },
  { name: "Pro", price: "59 €", descp: "Für kleine Teams mit Freigaben und Schnittstellen.", featured: true, items: ["10 Kanäle", "3 Personen", "3 Arbeitsbereiche", "Team-Funktionen", "API & Webhooks", "Erster Kommentar", "1.000 KI-Vorschläge / Monat"] },
  { name: "Agency", price: "149 €", descp: "Für Agenturen, die viele Kunden betreuen.", items: ["30 Kanäle", "10 Personen", "50 Kunden-Workspaces", "Freigaben durch Kunden", "Gebrandete Berichte", "5.000 KI-Vorschläge / Monat"] },
  { name: "Enterprise", price: "Auf Anfrage", descp: "Für Organisationen mit eigenen Anforderungen.", items: ["Kanäle & Personen nach Bedarf", "White-Label", "Single Sign-on", "IP-Allowlist", "Persönliche Einrichtung"] },
];

const cardIn = {
  hidden: { opacity: 0, x: -60 },
  visible: (i: number) => ({ opacity: 1, x: 0, transition: { delay: i * 0.18, duration: 0.6, ease: [0.16, 1, 0.3, 1] as const } }),
};

export function Pricing() {
  return (
    <section id="preise" className="relative overflow-hidden px-4 py-14 sm:py-20">
      <div className="aurora soft" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="relative">
        <SectionHead eyebrow="Preise" title="Ein Preis, der mitwächst." lead="Monatliche Abrechnung. Starte klein und wechsle den Tarif, sobald dein Team oder deine Kanäle wachsen." />
        <div className="mx-auto mt-10 grid max-w-6xl items-stretch gap-6 md:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          {PLANS.map((p, i) => {
            const paid = p.price.endsWith("€");
            return (
              <motion.div key={p.name} variants={cardIn} initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }} custom={i} className={`relative flex flex-col ${p.featured ? "z-10 lg:scale-[1.03]" : ""}`}>
                {/* animated conic-gradient border in the brand colours */}
                {p.featured && (
                  <div aria-hidden className="absolute -inset-[2px] overflow-hidden rounded-[26px]">
                    <div className="price-spin absolute -inset-full blur-[2px]" />
                    <div className="absolute inset-[2px] rounded-[24px] bg-white" />
                  </div>
                )}
                <article className={`relative flex flex-1 flex-col gap-7 rounded-3xl bg-white p-7 ${p.featured ? "shadow-[0_40px_80px_-30px_rgba(0,71,171,0.55)]" : "shadow-[0_20px_50px_-30px_rgba(16,40,110,0.35)] ring-1 ring-line"}`}>
                  <header className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display text-2xl font-bold text-cobalt">{p.name}</h3>
                      {p.featured && (
                        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-cobalt px-3 text-xs font-semibold text-white">
                          <Flame className="size-3.5" /> Empfohlen
                        </span>
                      )}
                    </div>
                    <p className="text-[0.95rem] leading-relaxed text-ink-2">{p.descp}</p>
                  </header>

                  <p className="flex items-baseline gap-1.5">
                    <span className={`font-display font-bold tracking-tight ${paid ? "text-[2.6rem]" : "text-[2.1rem]"} leading-none`}>{p.price}</span>
                    {paid && <span className="text-sm text-ink-3">/ Monat</span>}
                  </p>

                  <hr className="border-line" />

                  <ul className="flex flex-1 flex-col gap-3.5">
                    {p.items.map((it) => (
                      <li key={it} className="flex items-center gap-3 text-[0.95rem] text-ink-2">
                        <Check className="size-4 shrink-0 text-cobalt" strokeWidth={2.5} />
                        {it}
                      </li>
                    ))}
                  </ul>

                  <a
                    href={paid ? REGISTER_URL : `mailto:${CONTACT_EMAIL}?subject=Postfino%20Enterprise`}
                    className={`flex h-12 items-center justify-center rounded-full text-sm font-semibold transition-all hover:-translate-y-0.5 ${p.featured ? "bg-cobalt text-white shadow-[0_14px_30px_-12px_#0047ab] hover:bg-cobalt-2" : "text-ink ring-1 ring-line hover:bg-paper hover:ring-ink/20"}`}
                  >
                    {paid ? "Konto erstellen" : "Kontakt aufnehmen"}
                  </a>
                </article>
              </motion.div>
            );
          })}
        </div>
        <p className="mt-10 text-center text-xs text-ink-3">Vorläufige Preise zzgl. MwSt. Die verbindlichen Konditionen zeigt die Anwendung vor dem Abschluss.</p>
      </div>
    </section>
  );
}
