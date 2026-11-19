import type { Metadata } from "next";
import { OPERATOR } from "@/lib/legal";
import { JsonLd, pageMeta, subPageLd } from "@/lib/seo";
import { LegalPage } from "@/components/legal-page";

const TITLE = "Datenlöschung";
const DESCRIPTION = "So trennst du verbundene Konten und lässt deine Daten bei Postfino löschen.";
export const metadata: Metadata = pageMeta("/datenloeschung", TITLE, DESCRIPTION);

export default async function Page({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  // Meta's data-deletion callback links here with ?code=<confirmation code>; the deletion runs when the request arrives.
  const raw = (await searchParams).code;
  const code = typeof raw === "string" && /^[A-F0-9]{16}$/.test(raw) ? raw : null;
  return (
    <>
    <JsonLd data={subPageLd("/datenloeschung", TITLE, DESCRIPTION)} />
    <LegalPage title="Datenlöschung" updated="19. November 2026">
      {code && (
        <div role="status" className="not-prose mb-8 rounded-2xl bg-[#e8f7ee] p-5 text-[#0b3d22] ring-1 ring-[#9fd8b6]">
          <p className="font-semibold">Löschanfrage über Meta bearbeitet</p>
          <p className="mt-1 text-sm">
            Bestätigungscode: <span className="font-mono font-semibold tracking-wider">{code}</span>. Beim Eingang der Anfrage wurden die Zugriffsschlüssel des
            betreffenden Meta-Kontos gelöscht, die verbundenen Kanäle getrennt und die von Meta übernommenen Profildaten (Name, Benutzername, Profilbild) entfernt.
            Fragen dazu: <a href={`mailto:${OPERATOR.email}?subject=L%C3%B6schanfrage%20${code}`}>{OPERATOR.email}</a>
          </p>
        </div>
      )}
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
        Schreib uns von der E-Mail-Adresse deines Postfino-Kontos an <a href={`mailto:${OPERATOR.email}?subject=Datenl%C3%B6schung%20Postfino`}>{OPERATOR.email}</a> mit dem Betreff „Datenlöschung“.
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
    </>
  );
}
