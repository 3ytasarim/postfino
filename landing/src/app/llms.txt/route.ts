import { CONTACT_EMAIL, SITE_URL } from "@/lib/site";
import { FAQ } from "@/lib/faq";
import { LEGAL_LINKS, OPERATOR } from "@/lib/legal";

// Plain-text summary for AI assistants (https://llmstxt.org). Same facts as the visible website, nothing extra.
export const dynamic = "force-static";

export function GET() {
  const body = `# Postfino

> Postfino ist ein Social-Media-Tool zum Planen, Prüfen und Veröffentlichen von Beiträgen für Instagram, Facebook, LinkedIn, TikTok, YouTube, Threads, X, Pinterest, Bluesky, Mastodon und Google Unternehmensprofile – an einem Ort. Postfino ist eine Anwendung der ${OPERATOR.name}.

## Funktionen

- Planen & Veröffentlichen: Kalender mit Wochen- und Monatsansicht, Warteschlange und Drag & Drop. Ein Beitrag, mehrere Kanäle – mit Anpassungen pro Netzwerk.
- Community-Postfach: Kommentare und Nachrichten der verbundenen Kanäle an einem Ort beantworten.
- Insights: Reichweite, Interaktionen und beste Zeiten.
- Ideen-Board: Ideen sammeln, sortieren und zum Entwurf machen.
- KI-Schreibassistent: Texte umformulieren, kürzen, Hashtags vorschlagen. KI-Vorschläge sind als solche gekennzeichnet.
- Team & Freigaben: Rollen, Kommentare und Freigabe-Workflows für Teams und Kunden.
- Start Page & Kurzlinks: Link-in-Bio-Seite und gekürzte Links mit Klickzahlen.
- API & Webhooks: REST-API und Webhooks.
- Kunden-Workspaces für Agenturen: getrennte Arbeitsbereiche je Kunde, gebrandete Berichte, Freigaben durch den Kunden.
- White-Label & SSO: eigene Marke, Single Sign-on und IP-Allowlist.
- Sicherheit: optionale Zwei-Faktor-Anmeldung per Authenticator-App (z. B. Microsoft oder Google Authenticator).

## Preise (pro Monat)

- Starter: 19 € – 3 Kanäle, 1 Person, 1 Arbeitsbereich
- Pro: 59 € – 10 Kanäle, 3 Personen, 3 Arbeitsbereiche, Team-Funktionen, API & Webhooks
- Agency: 149 € – 30 Kanäle, 10 Personen, 50 Kunden-Workspaces, gebrandete Berichte
- Enterprise: auf Anfrage – White-Label, Single Sign-on, IP-Allowlist

## Häufige Fragen

${FAQ.map(([q, a]) => `### ${q}\n\n${a}`).join("\n\n")}

## Seiten

- [Startseite](${SITE_URL}/): Funktionen, Ablauf, Preise und FAQ
${LEGAL_LINKS.map(([href, label]) => `- [${label}](${SITE_URL}${href})`).join("\n")}

## Kontakt

E-Mail: ${CONTACT_EMAIL}

Anbieter: ${OPERATOR.name}, ${OPERATOR.street}, ${OPERATOR.city}, ${OPERATOR.country} – ${OPERATOR.email}
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
