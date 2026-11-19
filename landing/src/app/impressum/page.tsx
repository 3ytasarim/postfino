import type { Metadata } from "next";
import { LEGAL_V2 } from "@/lib/legal";
import { ImpressumV2 } from "@/components/legal-v2";
import { LegalPage, Todo } from "@/components/legal-page";
import { COMPANY, CONTACT_EMAIL, SITE_URL } from "@/lib/site";

export const metadata: Metadata = { title: "Impressum", description: `Anbieterkennzeichnung für Postfino, eine Anwendung der ${COMPANY}.`, alternates: { canonical: "/impressum" } };

export default function Page() {
  if (LEGAL_V2) return <ImpressumV2 />;
  return (
    <LegalPage title="Impressum" updated="14. November 2026">
      <h2>Anbieter</h2>
      <p>
        Postfino ({SITE_URL.replace(/^https?:\/\//, "")}) ist eine Anwendung der
        <br />
        <strong>{COMPANY}</strong>
        <br />
        <Todo>Straße und Hausnummer</Todo>
        <br />
        <Todo>PLZ, Ort, Staat / Land</Todo>
      </p>
      <h2>Vertreten durch</h2>
      <p>
        <Todo>Name des Managers / Geschäftsführers</Todo>
      </p>
      <h2>Kontakt</h2>
      <p>
        E-Mail: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        <br />
        Telefon: <Todo>Telefonnummer</Todo>
      </p>
      <h2>Registereintrag</h2>
      <p>
        Registrierungsbehörde und -nummer: <Todo>z. B. Secretary of State, File Number</Todo>
      </p>
      <h2>Umsatzsteuer</h2>
      <p>
        Umsatzsteuer-Identifikationsnummer bzw. Steuernummer: <Todo>sofern vorhanden</Todo>
      </p>
      <h2>Verantwortlich für den Inhalt</h2>
      <p>
        <Todo>Name, Anschrift wie oben</Todo>
      </p>
      <h2>Streitbeilegung</h2>
      <p>
        Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
      </p>
      <h2>Marken</h2>
      <p>Instagram, Facebook, Threads, LinkedIn, TikTok, YouTube, X, Pinterest, Bluesky, Mastodon und Google sind Marken ihrer jeweiligen Inhaber. Postfino steht in keiner Verbindung zu diesen Unternehmen und wird von ihnen nicht gesponsert.</p>
    </LegalPage>
  );
}
