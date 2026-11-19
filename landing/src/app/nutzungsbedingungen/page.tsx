import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { LEGAL_V2 } from "@/lib/legal";
import Link from "next/link";
import { LegalPage, Todo } from "@/components/legal-page";
import { COMPANY, CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Nutzungsbedingungen",
  description: `Bedingungen für die Nutzung von Postfino, einer Anwendung der ${COMPANY}.`,
  alternates: { canonical: "/nutzungsbedingungen" },
};

export default function Page() {
  if (LEGAL_V2) permanentRedirect("/agb");
  return (
    <LegalPage title="Nutzungsbedingungen" updated="14. November 2026">
      <h2>1. Geltungsbereich</h2>
      <p>Diese Bedingungen gelten für die Nutzung von Postfino, einer Web-Anwendung der {COMPANY} („wir“), durch Unternehmen, Selbstständige und Organisationen („du“).</p>

      <h2>2. Leistung</h2>
      <p>
        Postfino ermöglicht das Planen, Abstimmen und Veröffentlichen von Beiträgen in sozialen Netzwerken, das Beantworten von Kommentaren und das Auswerten von Kennzahlen. Die Anbindung erfolgt über die
        offiziellen Schnittstellen der Netzwerke. Der verfügbare Funktionsumfang richtet sich nach dem gewählten Tarif und nach dem, was die Netzwerke über ihre Schnittstellen zulassen.
      </p>

      <h2>3. Konto</h2>
      <p>Du bist für die Richtigkeit deiner Angaben und die Geheimhaltung deiner Zugangsdaten verantwortlich. Mitglieder, die du in dein Team einlädst, handeln in deinem Auftrag.</p>

      <h2>4. Deine Inhalte und die Regeln der Netzwerke</h2>
      <p>
        Du bleibst Inhaber deiner Inhalte und räumst uns nur die Rechte ein, die zur Speicherung, Verarbeitung und Veröffentlichung in deinem Auftrag nötig sind. Du stellst sicher, dass deine Inhalte keine
        Rechte Dritter oder Gesetze verletzen und die Nutzungsbedingungen der jeweiligen Netzwerke einhalten. Spam, irreführende Inhalte und automatisierte Interaktionen, die die Netzwerke verbieten, sind
        unzulässig.
      </p>

      <h2>5. Verfügbarkeit</h2>
      <p>Wir bemühen uns um einen störungsfreien Betrieb. Ausfälle oder Änderungen der Schnittstellen der Netzwerke liegen außerhalb unseres Einflusses; schlägt eine Veröffentlichung fehl, wird dies im Kalender angezeigt.</p>

      <h2>6. Preise und Abrechnung</h2>
      <p>
        Es gelten die auf der <Link href="/#preise">Preisseite</Link> genannten Tarife zuzüglich gesetzlicher Umsatzsteuer. <Todo>Zahlungsweise, Laufzeit und Kündigungsfrist</Todo>
      </p>

      <h2>7. Haftung</h2>
      <p>Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit. Im Übrigen haften wir nur für die Verletzung wesentlicher Vertragspflichten und begrenzt auf den vorhersehbaren, typischen Schaden.</p>

      <h2>8. Kündigung und Löschung</h2>
      <p>
        Du kannst dein Konto jederzeit kündigen. Wie deine Daten gelöscht werden, beschreibt die Seite <Link href="/datenloeschung">Datenlöschung</Link>. Wir können Konten bei schwerwiegenden Verstößen gegen
        diese Bedingungen sperren.
      </p>

      <h2>9. Datenschutz</h2>
      <p>
        Es gilt unsere <Link href="/datenschutz">Datenschutzerklärung</Link>.
      </p>

      <h2>10. Schlussbestimmungen</h2>
      <p>
        Es gilt das Recht von <Todo>Rechtswahl / Gerichtsstand</Todo>. Fragen: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </LegalPage>
  );
}
