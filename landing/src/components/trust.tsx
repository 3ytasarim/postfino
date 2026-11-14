import { Database, KeyRound, Lock, MailCheck, ShieldCheck, Smartphone } from "lucide-react";
import { Reveal, SectionHead } from "./reveal";

const ITEMS = [
  { icon: ShieldCheck, title: "Offizielle Anmeldung", text: "Kanäle werden über die Login-Fenster der Netzwerke verbunden (OAuth). Deine Passwörter bleiben bei Instagram, LinkedIn & Co." },
  { icon: Lock, title: "Verschlüsselte Tokens", text: "Zugriffsschlüssel der Netzwerke werden verschlüsselt gespeichert und nur zum Veröffentlichen verwendet." },
  { icon: MailCheck, title: "E-Mail-Bestätigung", text: "Neue Konten bestätigen ihre Adresse mit einem einmaligen 6-stelligen Code." },
  { icon: Smartphone, title: "Zwei-Faktor-Schutz", text: "Optional mit Authenticator-App absichern." },
  { icon: Database, title: "Daten in der EU", text: "Die Datenbank liegt in Frankfurt am Main." },
  { icon: KeyRound, title: "Rollen & Rechte", text: "Jedes Teammitglied sieht und darf nur, was seine Rolle erlaubt." },
];

export function Trust() {
  return (
    <section className="relative px-4 py-24 sm:py-32" aria-labelledby="trust-title">
      <SectionHead eyebrow="Sicherheit" title={<span id="trust-title">Deine Kanäle sind bei uns gut aufgehoben.</span>} />
      <ul className="mx-auto mt-14 grid max-w-6xl gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map(({ icon: I, title, text }, i) => (
          <Reveal as="li" key={title} delay={(i % 3) * 0.08} className="flex gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white text-cobalt-2 shadow-sm ring-1 ring-line">
                <I className="size-5" />
              </span>
              <div>
                <h3 className="font-display text-lg font-bold">{title}</h3>
                <p className="mt-1 leading-relaxed text-ink-2">{text}</p>
              </div>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}
