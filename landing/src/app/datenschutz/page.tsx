import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, Todo } from "@/components/legal-page";
import { COMPANY, CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Datenschutzerklärung",
  description: "Welche Daten Postfino verarbeitet, wofür, wie lange und welche Rechte du hast – inklusive der Daten aus verbundenen Social-Media-Konten.",
  alternates: { canonical: "/datenschutz" },
};

export default function Page() {
  return (
    <LegalPage title="Datenschutzerklärung" updated="14. November 2026">
      <p>
        Diese Erklärung beschreibt, wie Postfino personenbezogene Daten verarbeitet – auf dieser Website und in der Web-Anwendung. Postfino ist eine Anwendung der {COMPANY}.
      </p>

      <h2>1. Verantwortlicher</h2>
      <p>
        {COMPANY}, <Todo>Anschrift</Todo>
        <br />
        E-Mail: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>

      <h2>2. Welche Daten wir verarbeiten</h2>
      <h3>Konto und Team</h3>
      <p>Name, E-Mail-Adresse, Passwort (nur als sicherer Hash gespeichert), Sprache, Zeitzone, Rolle im Team, Einladungen sowie – falls aktiviert – Daten zur Zwei-Faktor-Anmeldung.</p>
      <h3>Verbundene Social-Media-Konten</h3>
      <p>
        Wenn du ein Netzwerk verbindest, meldest du dich im offiziellen Fenster des Netzwerks an und bestätigst die angefragten Berechtigungen. Wir erhalten dabei kein Passwort, sondern einen Zugriffsschlüssel
        (Access Token), den wir verschlüsselt speichern. Zusätzlich speichern wir Kennung, Name und Profilbild des verbundenen Kontos bzw. der Seite.
      </p>
      <h3>Inhalte</h3>
      <p>Beiträge, Entwürfe, Ideen, Medien (Bilder, Videos), Kommentare und Notizen, die du oder dein Team in Postfino anlegt, sowie Freigabe- und Änderungsverläufe.</p>
      <h3>Daten aus den Netzwerken</h3>
      <p>
        Je nach Netzwerk und erteilter Berechtigung: Kommentare und Antworten zu deinen Beiträgen (Community-Postfach), Kennzahlen deiner Beiträge und Konten (Insights) sowie der Veröffentlichungsstatus.
      </p>
      <h3>Technische Daten</h3>
      <p>IP-Adresse, Browsertyp und Zeitpunkt des Zugriffs in Server-Protokollen, Sicherheits- und Änderungsprotokolle (Audit-Log) innerhalb der Anwendung.</p>

      <h2>3. Daten von Meta (Facebook, Instagram, Threads)</h2>
      <p>Verbindest du eine Facebook-Seite oder ein Instagram-Professional-Konto, nutzt Postfino die offizielle Graph API von Meta ausschließlich für folgende Zwecke:</p>
      <ul>
        <li>Liste deiner Seiten und verknüpften Instagram-Konten anzeigen, damit du auswählen kannst, welche du verbindest;</li>
        <li>von dir geplante Beiträge zum gewählten Zeitpunkt veröffentlichen;</li>
        <li>Kommentare zu deinen Beiträgen im Community-Postfach anzeigen und deine Antworten senden;</li>
        <li>Kennzahlen zu deinen Beiträgen und Konten in Berichten darstellen.</li>
      </ul>
      <p>
        Wir verkaufen diese Daten nicht, nutzen sie nicht für Werbung und geben sie nicht an Dritte weiter, außer an die unten genannten Auftragsverarbeiter, soweit für den Betrieb nötig. Du kannst die
        Verbindung jederzeit in Postfino trennen oder in deinen Facebook-Einstellungen unter „Business-Integrationen“ entfernen.
      </p>

      <h2>4. Zwecke und Rechtsgrundlagen</h2>
      <ul>
        <li>Bereitstellung der Anwendung, Veröffentlichung und Verwaltung deiner Inhalte – Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO);</li>
        <li>Sicherheit, Missbrauchsschutz, Fehleranalyse – berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO);</li>
        <li>Aufbewahrung von Rechnungsdaten – gesetzliche Pflicht (Art. 6 Abs. 1 lit. c DSGVO);</li>
        <li>optionale Funktionen wie der KI-Schreibassistent – nur wenn du sie aktiv verwendest (Art. 6 Abs. 1 lit. b DSGVO).</li>
      </ul>

      <h2>5. Empfänger und Auftragsverarbeiter</h2>
      <ul>
        <li>Datenbank-Hosting: Neon (PostgreSQL), Serverstandort Frankfurt am Main (EU);</li>
        <li>Server- und Speicher-Hosting: <Todo>Hosting-Anbieter und Standort</Todo>;</li>
        <li>E-Mail-Versand (Bestätigungs- und Einladungs-E-Mails): <Todo>E-Mail-Anbieter</Todo>;</li>
        <li>KI-Schreibassistent: Anthropic (Claude API) – nur der Text, den du an den Assistenten übergibst;</li>
        <li>die von dir verbundenen Netzwerke, an die deine Beiträge und Antworten übermittelt werden.</li>
      </ul>
      <p>Sofern Daten in Staaten außerhalb der EU übermittelt werden, erfolgt dies auf Grundlage von Standardvertragsklauseln der EU-Kommission oder eines Angemessenheitsbeschlusses.</p>

      <h2>6. Speicherdauer</h2>
      <p>
        Wir speichern Daten, solange dein Konto besteht. Trennst du ein Netzwerk, wird dessen Zugriffsschlüssel sofort ungültig gemacht und gelöscht; geplante Beiträge für diesen Kanal werden abgebrochen.
        Löschst du dein Konto, entfernen wir deine Daten innerhalb von 30 Tagen, soweit keine gesetzlichen Aufbewahrungspflichten bestehen. Details: <Link href="/datenloeschung">Datenlöschung</Link>.
      </p>

      <h2>7. Website</h2>
      <p>Diese Website setzt keine Tracking- oder Werbe-Cookies und bindet keine Analyse-Dienste ein. Schriftarten werden lokal ausgeliefert.</p>

      <h2>8. Deine Rechte</h2>
      <p>
        Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch (Art. 15–21 DSGVO) sowie das Recht, eine erteilte Einwilligung jederzeit zu
        widerrufen. Schreib uns dazu an <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren.
      </p>

      <h2>9. Sicherheit</h2>
      <p>Verbindungen sind per TLS verschlüsselt, Zugriffsschlüssel der Netzwerke werden verschlüsselt gespeichert, Passwörter nur als Hash. Zugriffe innerhalb eines Teams werden über Rollen gesteuert und protokolliert.</p>

      <h2>10. Änderungen</h2>
      <p>Wir passen diese Erklärung an, wenn sich Funktionen oder Rechtslage ändern. Es gilt die jeweils hier veröffentlichte Fassung.</p>
    </LegalPage>
  );
}
