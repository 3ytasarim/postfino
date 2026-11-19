import { LegalPage } from "./legal-page";
import { LEGAL_STAND, OPERATOR } from "@/lib/legal";

const Mail = () => <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>;

/** Postal block used as provider / controller / Widerruf address. */
function Address({ withRep = true }: { withRep?: boolean }) {
  return (
    <p>
      {OPERATOR.name}
      <br />
      {OPERATOR.street}
      <br />
      {OPERATOR.city}
      <br />
      {OPERATOR.country}
      <br />
      E-Mail <Mail />
      {withRep && (
        <>
          <br />
          Vertreten durch {OPERATOR.representative}.
        </>
      )}
    </p>
  );
}

export function ImpressumV2() {
  return (
    <LegalPage title="Impressum" lead="Anbieterkennzeichnung für postfino.com." updated={LEGAL_STAND}>

      <h2>Anbieter und Vertragspartner</h2>
      <p>
        {OPERATOR.name}
        <br />
        {OPERATOR.street}
        <br />
        {OPERATOR.city}
        <br />
        {OPERATOR.country}
      </p>
      <p>
        Rechtsform Limited Liability Company (LLC)
        <br />
        Sitz der Gesellschaft New Mexico, United States
      </p>
      <p>Postfino ist ein Angebot der {OPERATOR.name}.</p>

      <h2>Vertretungsberechtigt</h2>
      <p>{OPERATOR.representative}, Geschäftsführer</p>

      <h2>Kontakt</h2>
      <p>
        E-Mail <Mail />
        <br />
        Website postfino.com
      </p>
    </LegalPage>
  );
}

export function DatenschutzV2() {
  return (
    <LegalPage title="Datenschutzerklärung" lead="Für die Website postfino.com und die Nutzung des Social-Media-Tools Postfino." updated={LEGAL_STAND}>

      <h2>1. Verantwortlicher und Kontakt</h2>
      <Address />
      <p>Über diese E-Mail-Adresse erreichen Sie uns auch für Datenschutzanfragen.</p>

      <h2>2. Website, Konto und Support</h2>
      <p>
        Beim Aufruf der Website und der Anwendung verarbeiten wir technische Verbindungsdaten wie die IP-Adresse, den Zeitpunkt der Anfrage und Browserinformationen. Wir verwenden sie zur Auslieferung der
        Seiten, zur Fehlerbehebung und zum Schutz des Dienstes. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse liegt im sicheren und funktionsfähigen Betrieb.
      </p>
      <p>
        Für Registrierung, Anmeldung, Testzugang und laufende Nutzung verarbeiten wir die Kontakt-, Konto- und Anmeldedaten, die Sie eingeben oder die bei der Nutzung entstehen. Das umfasst erforderliche
        System-E-Mails, etwa zur Anmeldung, zu Buchungen und zum Konto. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, soweit Sie selbst Vertragspartner sind oder vorvertragliche Schritte verlangen. Für
        geschäftliche Ansprechpartner ist Art. 6 Abs. 1 lit. f DSGVO maßgeblich. Unser Interesse besteht in der Kommunikation mit unseren Kunden und der Bereitstellung ihrer Zugänge.
      </p>
      <p>
        Bei Supportanfragen verarbeiten wir die Absenderdaten, den Inhalt der Anfrage und gegebenenfalls die dazugehörigen Kontodaten, um die Anfrage zu bearbeiten. Je nach Bezug beruht dies auf Art. 6 Abs. 1
        lit. b oder f DSGVO. Wir versenden keine Newsletter oder Marketing-E-Mails.
      </p>

      <h2>3. Checkout und Abrechnung</h2>
      <p>
        Bei einer kostenpflichtigen Buchung verarbeiten wir die für Bestellung und Abrechnung erforderlichen Kontakt-, Rechnungs-, Tarif- und Transaktionsdaten. Das dient dem Vertragsabschluss, der Zahlung und
        der Rechnungsstellung nach Art. 6 Abs. 1 lit. b DSGVO. Soweit wir gesetzliche Buchführungs- oder Aufbewahrungspflichten erfüllen, stützen wir die Verarbeitung auf Art. 6 Abs. 1 lit. c DSGVO, sofern
        entsprechendes Unionsrecht oder Recht eines Mitgliedstaats gilt.
      </p>

      <p className="legal-chapter">Social Media, KI und Cookies</p>
      <h2>4. Verknüpfte Social-Media-Konten</h2>
      <p>
        Wenn Sie einen Kanal verknüpfen, erhalten wir im Rahmen der erteilten Plattformberechtigungen Informationen zum verbundenen Konto, Zugriffs-Tokens sowie funktionsabhängig Beitragsdaten, Medien,
        Statistiken, Kommentare und Direktnachrichten. Je nach Funktion können darin Nutzernamen, Profile, Nachrichteninhalte und Interaktionen Dritter enthalten sein. Die Daten stammen aus Ihren Eingaben oder
        aus der Schnittstelle des jeweiligen Netzwerks.
      </p>
      <p>
        Wir verwenden die Daten, um Beiträge zu planen oder zu veröffentlichen, Statistiken anzuzeigen und Kommentare oder Direktnachrichten zu verwalten. Die erteilten Berechtigungen bestimmen, welche Daten
        zwischen Postfino und dem Netzwerk ausgetauscht werden. Die Netzwerke verarbeiten Daten für ihre eigenen Dienste auch nach ihren jeweiligen Datenschutzbestimmungen.
      </p>
      <p>
        Soweit wir die Plattformverbindung für Ihren eigenen Vertrag bereitstellen, gilt Art. 6 Abs. 1 lit. b DSGVO. Für eigene Verarbeitungen im Rahmen eines Unternehmenskontos gilt Art. 6 Abs. 1 lit. f
        DSGVO, soweit die Verarbeitung zur Bereitstellung und Verwaltung des Geschäftskontos erforderlich ist. Verarbeiten wir Inhalte im Auftrag eines Geschäftskunden, bestimmt dieser die Zwecke und
        Rechtsgrundlagen. Die Auftragsverarbeitung wird gesondert nach Art. 28 DSGVO geregelt.
      </p>

      <h2>5. KI und öffentliche Freigabelinks</h2>
      <p>
        Wenn Sie eine KI-Funktion aufrufen, verarbeiten wir Ihre Eingabe und die Inhalte, die Sie für die Funktion auswählen, zur Erstellung des angeforderten Ergebnisses. Wenn Sie einen öffentlichen
        Freigabelink erstellen, werden die dafür ausgewählten Inhalte für Personen zugänglich, die den Link erhalten. Diese Personen können den Link weitergeben. Für die Bereitstellung gelten die in Abschnitt 4
        beschriebenen Rollen und Rechtsgrundlagen entsprechend.
      </p>

      <h2>6. Cookies und ähnliche Technologien</h2>
      <p>
        Für technisch unbedingt erforderliche Speicherungen oder Zugriffe auf Ihrem Gerät gilt § 25 Abs. 2 TDDDG. Soweit wir zusätzliche einwilligungspflichtige Technologien einsetzen, aktivieren wir sie erst
        nach Ihrer Wahl im Cookie-Banner. Rechtsgrundlagen sind § 25 Abs. 1 TDDDG und für die damit verbundene Verarbeitung personenbezogener Daten Art. 6 Abs. 1 lit. a DSGVO. Sie können eine Einwilligung mit
        Wirkung für die Zukunft widerrufen.
      </p>

      <p className="legal-chapter">Empfänger, Löschung und Rechte</p>
      <h2>7. Hosting und Zugriff</h2>
      <p>
        Wir hosten Postfino bei der Hetzner Online GmbH in Nürnberg, Deutschland. Zur Bearbeitung von Support-, Betriebs- und Sicherheitsaufgaben kann das interne Postfino-Team im dafür erforderlichen Umfang
        aus Deutschland und der Türkei auf Daten zugreifen. Verantwortlicher beziehungsweise Auftragsverarbeiter ist die in den USA ansässige {OPERATOR.name}.
      </p>
      <p>
        Daten können abhängig von der genutzten Funktion außerdem an das ausgewählte Social-Media-Netzwerk und an Dienstleister für Betrieb, Anmeldungen, System-E-Mails, Abrechnung oder KI übermittelt werden.
        Öffentliche Freigabelinks stellen ausgewählte Inhalte den Personen zur Verfügung, die den Link öffnen.
      </p>

      <h2>8. Trennen von Kanälen und Aufbewahrung</h2>
      <p>
        Wenn Sie einen Social-Media-Kanal trennen, wird die Verknüpfung in Postfino automatisch beendet. Inhalte oder Nachrichten, die bereits auf dem jeweiligen Netzwerk veröffentlicht oder versandt wurden,
        verwalten Sie dort. Mit der endgültigen Schließung Ihres Postfino-Kontos werden die zugehörigen Kontodaten aus der aktiven Anwendung entfernt. Für gesetzlich aufzubewahrende Abrechnungsdaten und Daten,
        die wir zur Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen benötigen, gelten die jeweils einschlägigen Aufbewahrungspflichten und Verjährungsfristen.
      </p>

      <h2>9. Ihre Datenschutzrechte</h2>
      <p>
        Sie haben nach Maßgabe der DSGVO das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit. Eine Einwilligung können Sie jederzeit mit Wirkung für die
        Zukunft widerrufen. Sie können Verarbeitungen auf Grundlage berechtigter Interessen aus Gründen widersprechen, die sich aus Ihrer besonderen Situation ergeben. Gegen eine Verarbeitung für Direktwerbung
        können Sie jederzeit ohne Angabe von Gründen Widerspruch einlegen.
      </p>
      <p>
        Wenden Sie sich dafür an <Mail />. Sie können sich auch bei einer Datenschutzaufsichtsbehörde beschweren, beispielsweise an Ihrem gewöhnlichen Aufenthaltsort, an Ihrem Arbeitsplatz oder am Ort des
        mutmaßlichen Verstoßes. Bei Daten, die wir nur im Auftrag eines Geschäftskunden verarbeiten, ist dieser der erste Ansprechpartner.
      </p>
    </LegalPage>
  );
}

/** Blank line for the Widerruf form. */
const Blank = ({ w = "14rem" }: { w?: string }) => <span aria-hidden className="mx-1 inline-block border-b border-ink-3 align-baseline" style={{ width: `min(${w}, 100%)` }} />;

export function AgbV2() {
  return (
    <LegalPage title="Allgemeine Geschäftsbedingungen" lead="Für Privat- und Geschäftskunden, die Postfino über postfino.com nutzen oder buchen." updated={LEGAL_STAND}>

      <h2>1. Anbieter und Geltungsbereich</h2>
      <Address />
      <p>
        Diese AGB gelten für den Testzugang und für kostenpflichtige Abonnements. Verbraucher und Unternehmer bestimmen sich nach §§ 13 und 14 BGB. Für Kunden, die für ein Unternehmen buchen, muss die handelnde
        Person zum Vertragsschluss für dieses Unternehmen berechtigt sein.
      </p>

      <h2>2. Dienst und Tarifumfang</h2>
      <p>
        Postfino ist eine webbasiert bereitgestellte Software zum Verwalten von Social-Media-Kanälen. Der vereinbarte Tarif kann insbesondere Beitragsplanung und Veröffentlichung, Auswertungen, Verwaltung von
        Kommentaren und Direktnachrichten, KI-Funktionen sowie öffentliche Freigabelinks umfassen. Der konkrete Funktionsumfang und die jeweiligen Grenzen ergeben sich aus der Tarifbeschreibung im Zeitpunkt der
        Buchung.
      </p>
      <p>
        Die Nutzung eines Kanals setzt ein berechtigtes Konto beim jeweiligen Netzwerk, die erforderlichen Freigaben und eine verfügbare Schnittstelle voraus. Die Bedingungen des Netzwerks gelten für die
        Nutzung des jeweiligen Kontos. Wird die Ausführung eines Beitrags durch das Netzwerk abgelehnt oder verzögert, kann das die Veröffentlichung beeinflussen. Postfino bleibt für die vertragsgemäße
        Erbringung seiner eigenen Leistungen verantwortlich.
      </p>

      <h2>3. Sieben Tage kostenlos testen</h2>
      <p>
        Sie können Postfino sieben Tage lang kostenlos testen. Mit Ablauf der sieben Tage endet der Test automatisch. Ab dem achten Tag stehen die Tool-Funktionen erst nach Abschluss eines kostenpflichtigen
        Abos wieder zur Verfügung. Aus dem Test entsteht weder automatisch ein kostenpflichtiges Abonnement noch eine Zahlungspflicht.
      </p>

      <h2>4. Bestellung und Zahlung</h2>
      <p>
        Ein kostenpflichtiges Abo buchen Sie in einem separaten Checkout auf postfino.com. Vor der Bestellung sehen Sie die wesentlichen Leistungen, den Gesamtpreis und das für Sie geltende
        Abrechnungsintervall sowie die Laufzeit und etwaige Verlängerungs- und Kündigungsbedingungen. Mit der zahlungspflichtigen Bestellung geben Sie ein verbindliches Angebot ab. Der Vertrag kommt durch
        ausdrückliche Annahme oder Freischaltung des gebuchten Tarifs zustande. Verbraucher erhalten eine Vertragsbestätigung auf einem dauerhaften Datenträger, etwa per E-Mail.
      </p>

      <p className="legal-chapter">Nutzung, Kündigung und Haftung</p>
      <h2>5. Nutzerkonten, Rechte an Inhalten und Verhalten</h2>
      <p>
        Sie verwenden nur Social-Media-Konten und Inhalte, für die Sie die erforderlichen Rechte und Berechtigungen haben. Schützen Sie Ihre Zugangsdaten und benachrichtigen Sie uns bei Anzeichen eines
        unbefugten Zugriffs. Sie bleiben Inhaber Ihrer Rechte an den eingebrachten Inhalten. Sie räumen uns das einfache, für den Dienst erforderliche Nutzungsrecht ein, um Inhalte nach Ihren Einstellungen zu
        speichern, technisch zu verarbeiten, zur Freigabe anzuzeigen und an das gewählte Netzwerk zu übertragen. Das Nutzungsrecht ist auf diese Zwecke und die dafür notwendige Dauer beschränkt.
      </p>
      <p>
        Sie dürfen Postfino insbesondere nicht für rechtswidrige Inhalte, unbefugte Kontozugriffe, irreführende Massenkommunikation oder Verstöße gegen Rechte Dritter einsetzen. Bei einem konkreten erheblichen
        Verstoß können wir die betroffene Funktion oder den Zugang verhältnismäßig beschränken. Soweit zumutbar, geben wir Ihnen vorher Gelegenheit zur Stellungnahme oder Abhilfe. Bei akuter Gefahr können wir
        sofort handeln und Sie anschließend informieren.
      </p>
      <p>Prüfen Sie KI-Ergebnisse vor Veröffentlichung. Bei öffentlichen Freigabelinks entscheiden Sie, welche Inhalte Sie freigeben. Personen mit Zugriff auf den Link können ihn weiterleiten.</p>

      <h2>6. Laufzeit, Kündigung und Kontoschließung</h2>
      <p>
        Laufzeit, Abrechnungsintervall und Kündigungsfristen des kostenpflichtigen Tarifs ergeben sich aus den vor der Buchung angezeigten Tarifbedingungen. Für Verbraucher gelten die gesetzlichen Grenzen für
        Laufzeit und Verlängerung. Kündigungen können nach Maßgabe der gesetzlichen Vorgaben über die Kündigungsschaltfläche der Website erklärt werden. Das Recht zur außerordentlichen Kündigung aus wichtigem
        Grund bleibt bestehen.
      </p>
      <p>
        Die Kündigung eines Tarifs und die endgültige Schließung des Kontos sind unterschiedliche Vorgänge. Bei einer endgültigen Kontoschließung endet die Nutzung des Kontos und seine Daten werden aus der
        aktiven Anwendung entfernt. Gesetzliche Ansprüche auf Herausgabe, Mitnahme oder Bereitstellung von Daten bleiben bestehen. Bereits an externe Netzwerke übertragene Beiträge oder Nachrichten werden dort
        nach den Regeln des jeweiligen Netzwerks verwaltet.
      </p>

      <h2>7. Mängel, Änderungen und Haftung</h2>
      <p>
        Es gelten die gesetzlichen Mängel- und Haftungsregeln. Die Rechte von Verbrauchern bei digitalen Produkten, einschließlich der gesetzlichen Pflichten zur Bereitstellung von Aktualisierungen, bleiben
        bestehen. Änderungen eines digitalen Produkts für Verbraucher, die über die Aufrechterhaltung der Vertragsmäßigkeit hinausgehen, erfolgen nur nach Maßgabe des § 327r BGB, soweit diese Vorschrift
        anwendbar ist.
      </p>

      <h2>8. Anwendbares Recht</h2>
      <p>
        Es gilt deutsches Recht. Bei Verbrauchern bleiben zwingende Verbraucherschutzvorschriften des Staates ihres gewöhnlichen Aufenthalts wirksam, soweit sie ohne diese Rechtswahl anzuwenden wären.
      </p>

      <h2 id="widerruf">Widerruf für Verbraucher</h2>
      <p>Für entgeltliche Online-Abos im deutschen Verbrauchergeschäft.</p>

      <h3>Widerrufsrecht und Frist</h3>
      <p>
        Sie können diesen Vertrag innerhalb von 14 Tagen ohne Angabe von Gründen widerrufen. Die Frist beginnt mit dem Tag des Vertragsschlusses. Um den Widerruf zu erklären, können Sie uns zum Beispiel einen
        Brief oder eine E-Mail mit einer eindeutigen Erklärung senden. Sie können auch die elektronische Widerrufsfunktion nutzen. Für die Einhaltung der Frist genügt es, dass Sie Ihre Erklärung vor
        Fristablauf absenden.
      </p>
      <Address withRep={false} />
      <p>
        Sie können das Formular unten verwenden. Bei Nutzung der elektronischen Widerrufsfunktion erhalten Sie unverzüglich eine Eingangsbestätigung auf einem dauerhaften Datenträger.
      </p>

      <h3>Folgen des Widerrufs</h3>
      <p>
        Wir erstatten Ihnen alle Zahlungen, die wir aus dem widerrufenen Vertrag erhalten haben, unverzüglich und spätestens 14 Tage, nachdem Ihr Widerruf bei uns eingegangen ist. Wir nutzen dafür dasselbe
        Zahlungsmittel wie bei der Zahlung, außer wir haben ausdrücklich etwas anderes mit Ihnen vereinbart. Für die Erstattung berechnen wir Ihnen keine Gebühren.
      </p>
      <p>
        Wenn Sie ausdrücklich verlangt haben, dass wir die entgeltliche Dienstleistung vor Ablauf der Widerrufsfrist beginnen, schulden Sie unter den gesetzlichen Voraussetzungen einen angemessenen Betrag für
        den bis zu Ihrem Widerruf erbrachten Anteil der vertraglich vorgesehenen Leistung.
      </p>

      <h3>Widerrufsformular</h3>
      <div className="mt-3 rounded-2xl bg-surface p-5 ring-1 ring-line sm:p-6">
        <p className="mt-0">
          An {OPERATOR.name}, {OPERATOR.street}, {OPERATOR.city}, {OPERATOR.country}, <Mail />
        </p>
        <p>
          Ich / Wir (*) widerrufe(n) den von mir / uns (*) abgeschlossenen Vertrag über die Erbringung der folgenden Dienstleistung (*)
          <Blank w="18rem" />
        </p>
        <p>
          Bestellt am <Blank w="9rem" /> Name <Blank />
        </p>
        <p>
          Anschrift <Blank w="22rem" />
        </p>
        <p>
          Datum <Blank w="8rem" /> Unterschrift (nur bei Mitteilung auf Papier) <Blank w="10rem" />
        </p>
        <p className="text-sm">(*) Unzutreffendes streichen.</p>
      </div>
    </LegalPage>
  );
}

export function SicherheitV2() {
  return (
    <LegalPage title="Sicherheit bei Postfino" lead="Hosting, Zugriff und Meldung von Sicherheitsproblemen." updated={LEGAL_STAND}>

      <h2>Hosting und Datenzugriff</h2>
      <p>
        Postfino wird bei Hetzner in Nürnberg, Deutschland, gehostet. Für Betrieb und Support kann das interne Team von {OPERATOR.name} aus Deutschland und der Türkei auf das System zugreifen. Das Team ist an
        Vertraulichkeits- und Datenschutzvereinbarungen gebunden.
      </p>

      <h2>Zugriff auf verbundene Social-Media-Kanäle</h2>
      <p>
        Die Anbindung eines Kanals erfolgt im Rahmen der von der jeweiligen Plattform erteilten Berechtigungen. Sobald Sie einen Kanal in Postfino trennen, wird die Verbindung in Postfino beendet. Wenn Sie
        zusätzlich die Berechtigung für Postfino beim Netzwerk widerrufen möchten, können Sie die Einstellungen für verbundene Dienste beim jeweiligen Netzwerk prüfen.
      </p>

      <h2>Öffentliche Freigabelinks</h2>
      <p>Öffentliche Freigabelinks ermöglichen den Zugriff auf die jeweils freigegebenen Inhalte. Prüfen Sie vor der Freigabe, welche Inhalte der Link zugänglich macht und an wen Sie ihn senden.</p>

      <h2>Sicherheitsprobleme melden</h2>
      <p>
        Bei einem vermuteten unbefugten Zugriff, einem möglichen Datenvorfall oder einer Sicherheitslücke schreiben Sie an <Mail />. Bitte nennen Sie die betroffene Funktion oder Adresse, den Zeitpunkt mit
        Zeitzone und eine kurze Beschreibung der Beobachtung. Verwenden Sie anonymisierte Beispiele und entfernen Sie Passwörter, Tokens und personenbezogene Daten aus Anhängen. Bei sensiblen Details stimmen
        Sie zuerst einen geeigneten Übermittlungsweg mit uns ab.
      </p>
      <p>Wenn Ihr Postfino-Konto betroffen ist, geben Sie die zugehörige E-Mail-Adresse an. Geben Sie mögliche Sicherheitsprobleme bitte direkt an unser Team weiter.</p>
    </LegalPage>
  );
}
