import type { Metadata } from "next";
import { CONTACT_EMAIL, SITE_URL } from "./site";
import { OPERATOR } from "./legal";

export const HOME_TITLE = "Postfino – Social-Media-Planung für Marken & Agenturen";
export const HOME_DESCRIPTION =
  "Plane, prüfe und veröffentliche Beiträge für Instagram, Facebook, LinkedIn, TikTok, YouTube und mehr – an einem Ort. Mit Kalender, Ideen-Board, Community-Postfach, Insights und Freigaben im Team.";

// Share image (centered "P." mark). Pages that set their own openGraph must list it again, Next does not merge it in.
const SHARE_IMAGE = { url: "/opengraph-image.png", width: 1200, height: 630, alt: "Postfino" };

/** Per-page metadata: own title, description, self-referencing canonical and matching Open Graph / X card. */
export function pageMeta(path: string, title: string, description: string): Metadata {
  const full = `${title} · Postfino`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", locale: "de_DE", siteName: "Postfino", url: path, title: full, description, images: [SHARE_IMAGE] },
    twitter: { card: "summary_large_image", title: full, description, images: [SHARE_IMAGE] },
  };
}

export const ORG_ID = `${SITE_URL}/#org`;
export const SITE_ID = `${SITE_URL}/#website`;

export const ORGANIZATION = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: OPERATOR.name,
  url: SITE_URL,
  email: OPERATOR.email,
  logo: { "@type": "ImageObject", url: `${SITE_URL}/icon.png`, width: 512, height: 512 },
  address: { "@type": "PostalAddress", streetAddress: OPERATOR.street, addressLocality: "Albuquerque", addressRegion: "NM", postalCode: "87110", addressCountry: "US" },
  contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: CONTACT_EMAIL, availableLanguage: "de" },
  brand: { "@type": "Brand", name: "Postfino", logo: `${SITE_URL}/icon.png` },
} as const;

/** WebPage + BreadcrumbList for a sub page, rendered into the server HTML. */
export function subPageLd(path: string, name: string, description: string) {
  const url = `${SITE_URL}${path}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${url}#webpage`, url, name, description, inLanguage: "de-DE", isPartOf: { "@id": SITE_ID }, publisher: { "@id": ORG_ID }, breadcrumb: { "@id": `${url}#breadcrumb` } },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Startseite", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name, item: url },
        ],
      },
    ],
  };
}

export function JsonLd({ data }: { data: object }) {
  // "<" is escaped so text inside the JSON can never close the script tag.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
