import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { SmoothScroll } from "@/components/smooth-scroll";
import "./globals.css";
import { COMPANY, CONTACT_EMAIL, SITE_URL } from "@/lib/site";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });

const title = "Postfino – Social-Media-Planung für Marken & Agenturen";
const description =
  "Plane, prüfe und veröffentliche Beiträge für Instagram, Facebook, LinkedIn, TikTok, YouTube und mehr – an einem Ort. Mit Kalender, Ideen-Board, Community-Postfach, Insights und Freigaben im Team.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: title, template: "%s · Postfino" },
  description,
  applicationName: "Postfino",
  openGraph: { title, description, type: "website", locale: "de_DE", siteName: "Postfino", url: "/" },
  twitter: { card: "summary_large_image", title, description },
  alternates: { canonical: "/" },
};
export const viewport: Viewport = { themeColor: "#0047ab" };

// Structured data: describes the product honestly (no ratings/reviews are claimed).
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: COMPANY, url: SITE_URL, email: CONTACT_EMAIL, brand: { "@type": "Brand", name: "Postfino" } },
    {
      "@type": "SoftwareApplication",
      name: "Postfino",
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#org` },
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description,
      offers: { "@type": "AggregateOffer", priceCurrency: "EUR", lowPrice: "19", highPrice: "149" },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${inter.variable} ${grotesk.variable}`}>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
          Zum Inhalt springen
        </a>
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
