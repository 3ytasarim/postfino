import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Datenlöschung",
  description: "So trennst du verbundene Konten und lässt deine Daten bei Postfino löschen.",
  alternates: { canonical: "/datenloeschung" },
};

export default function Page() {
  return (
    <LegalPage title="Datenlöschung" updated="14. November 2026">
      <p>Du kannst jederzeit bestimmen, welche Daten Postfino behält. Diese Seite erklärt, wie du verbundene Konten trennst und wie du die Löschung aller Daten veranlasst.</p>

      <h2>1. Verbundenes Konto trennen</h2>
      <ol>
        <li>Melde dich bei Postfino an und öffne „Kanäle“.</li>
        <li>Wähle den Kanal (z. B. deine Facebook-Seite oder dein Instagram-Konto) und klicke auf „Trennen“.</li>
        <li>Der Zugriffsschlüssel wird sofort ungültig gemacht und gelöscht, geplante Beiträge für diesen Kanal werden abgebrochen und – soweit das Netzwerk es erlaubt – wird die Berechtigung auch beim Netzwerk widerrufen.</li>
      </ol>

      <h2>2. Zugriff über Facebook entfernen</h2>
      <ol>
        <li>Öffne in Facebook „Einstellungen und Privatsphäre“ → „Einstellungen“ → „Business-Integrationen“ bzw. „Apps und Websites“.</li>
        <li>Wähle „Postfino“ und klicke auf „Entfernen“.</li>
        <li>Postfino kann danach nicht mehr auf deine Seiten oder Instagram-Konten zugreifen.</li>
      </ol>

      <h2>3. Alle Daten löschen lassen</h2>
      <p>
        Schreib uns von der E-Mail-Adresse deines Postfino-Kontos an <a href={`mailto:${CONTACT_EMAIL}?subject=Datenl%C3%B6schung%20Postfino`}>{CONTACT_EMAIL}</a> mit dem Betreff „Datenlöschung“.
        Wir bestätigen den Eingang und löschen innerhalb von 30 Tagen:
      </p>
      <ul>
        <li>dein Konto und Profil,</li>
        <li>alle Zugriffsschlüssel verbundener Netzwerke,</li>
        <li>Beiträge, Entwürfe, Ideen, Medien und Kommentare deiner Organisation, sofern du deren alleiniger Inhaber bist,</li>
        <li>aus den Netzwerken abgerufene Kommentare und Kennzahlen.</li>
      </ul>
      <p>Daten, die wir aus gesetzlichen Gründen aufbewahren müssen (z. B. Rechnungen), werden gesperrt und nach Ablauf der Frist gelöscht. Bereits in den Netzwerken veröffentlichte Beiträge bleiben dort bestehen und können von dir direkt im jeweiligen Netzwerk gelöscht werden.</p>
    </LegalPage>
  );
}
