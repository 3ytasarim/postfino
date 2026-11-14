"use client";
import type { PointerEvent } from "react";
import { Check } from "lucide-react";
import { Reveal, SectionHead } from "./reveal";
import { CONTACT_EMAIL, REGISTER_URL } from "@/lib/site";

// Mirrors the draft plan defaults of the app (packages/shared/src/plans.ts) – not yet a binding offer.
const PLANS = [
  { name: "Starter", price: "19 €", for: "Für Selbstständige", items: ["3 Kanäle", "1 Person", "1 Arbeitsbereich", "Kalender, Ideen & Insights", "100 KI-Vorschläge / Monat"] },
  { name: "Pro", price: "59 €", for: "Für kleine Teams", hot: true, items: ["10 Kanäle", "3 Personen", "3 Arbeitsbereiche", "Team-Funktionen", "API & Webhooks", "Erster Kommentar", "1.000 KI-Vorschläge / Monat"] },
  { name: "Agency", price: "149 €", for: "Für Agenturen", items: ["30 Kanäle", "10 Personen", "50 Kunden-Workspaces", "Freigaben durch Kunden", "Gebrandete Berichte", "5.000 KI-Vorschläge / Monat"] },
  { name: "Enterprise", price: "Auf Anfrage", for: "Für Organisationen", items: ["Kanäle & Personen nach Bedarf", "White-Label", "Single Sign-on", "IP-Allowlist", "Persönliche Einrichtung"] },
];

const track = (e: PointerEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
};

export function Pricing() {
  return (
    <section id="preise" className="relative overflow-hidden px-4 py-24 sm:py-32">
      <div className="aurora soft" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="relative">
        <SectionHead eyebrow="Preise" title="Ein Preis, der mitwächst." lead="Monatliche Abrechnung. Starte klein und wechsle den Tarif, sobald dein Team oder deine Kanäle wachsen." />
        <div className="mx-auto mt-16 grid max-w-6xl gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p, i) => (
            <Reveal key={p.name} delay={i * 0.08}>
              <article onPointerMove={track} className={`spot relative flex h-full flex-col rounded-[28px] p-6 transition-transform duration-500 hover:-translate-y-1 ${p.hot ? "bg-ink text-white shadow-[0_40px_80px_-30px_rgba(0,71,171,0.7)]" : "glass"}`}>
                {p.hot && <span className="absolute -top-3 left-6 rounded-full bg-gradient-to-r from-sky to-lilac px-3 py-1 text-xs font-bold text-white">Empfohlen für Teams</span>}
                <h3 className="font-display text-xl font-bold">{p.name}</h3>
                <p className={`text-sm ${p.hot ? "text-white/60" : "text-ink-3"}`}>{p.for}</p>
                <p className="mt-6 flex items-baseline gap-1.5">
                  <span className="font-display text-4xl font-bold tracking-tight">{p.price}</span>
                  {p.price.endsWith("€") && <span className={`text-sm ${p.hot ? "text-white/60" : "text-ink-3"}`}>/ Monat</span>}
                </p>
                <ul className="mt-6 flex-1 space-y-2.5 text-[0.95rem]">
                  {p.items.map((it) => (
                    <li key={it} className="flex gap-2.5">
                      <Check className={`mt-0.5 size-4 shrink-0 ${p.hot ? "text-sky" : "text-cobalt-2"}`} />
                      {it}
                    </li>
                  ))}
                </ul>
                <a href={p.price.endsWith("€") ? REGISTER_URL : `mailto:${CONTACT_EMAIL}?subject=Postfino%20Enterprise`} className={`mt-8 flex min-h-12 items-center justify-center rounded-full text-sm font-semibold transition-transform hover:-translate-y-0.5 ${p.hot ? "bg-white text-ink" : "bg-ink text-white"}`}>
                  {p.price.endsWith("€") ? "Konto erstellen" : "Kontakt aufnehmen"}
                </a>
              </article>
            </Reveal>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-ink-3">Vorläufige Preise zzgl. MwSt. Die verbindlichen Konditionen zeigt die Anwendung vor dem Abschluss.</p>
      </div>
    </section>
  );
}
