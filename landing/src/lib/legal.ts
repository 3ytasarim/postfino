// Legal texts v2 ("Fassung zur Freigabe", 18.11.2026): Impressum, Datenschutz, AGB incl. Widerruf, Sicherheit.
// Switched on with LEGAL_TEXTS_V2=1 at build time. Off = the previous pages stay live, /agb and /sicherheit return 404.
export const LEGAL_V2 = process.env.LEGAL_TEXTS_V2 === "1";

export const LEGAL_STAND = "18. November 2026";

export const OPERATOR = {
  name: "Bleibsichtbar LLC",
  street: "1209 Mountain Road Pl NE, Ste R",
  city: "Albuquerque, NM 87110",
  country: "United States",
  email: "info@bleibsichtbar.com",
  representative: "Semih Özdemir",
} as const;

export const LEGAL_LINKS: [string, string][] = LEGAL_V2
  ? [["/impressum", "Impressum"], ["/datenschutz", "Datenschutz"], ["/agb", "AGB"], ["/sicherheit", "Sicherheit"]]
  : [["/impressum", "Impressum"], ["/datenschutz", "Datenschutz"], ["/nutzungsbedingungen", "Nutzungsbedingungen"], ["/datenloeschung", "Datenlöschung"]];

export const LEGAL_SITEMAP = LEGAL_V2
  ? ["/impressum", "/datenschutz", "/agb", "/sicherheit"]
  : ["/impressum", "/datenschutz", "/nutzungsbedingungen", "/datenloeschung"];
