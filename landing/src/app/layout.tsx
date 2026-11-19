import type { Metadata, Viewport } from "next";
import { Inter, Outfit, Space_Grotesk } from "next/font/google";
import { SmoothScroll } from "@/components/smooth-scroll";
import { AnimGate } from "@/components/anim-gate";
import "./globals.css";
import { SITE_URL } from "@/lib/site";
import { HOME_DESCRIPTION, HOME_TITLE, JsonLd, ORGANIZATION, ORG_ID, SITE_ID } from "@/lib/seo";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], weight: ["600"], variable: "--font-outfit", display: "swap" });

const title = HOME_TITLE;
const description = HOME_DESCRIPTION;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: title, template: "%s · Postfino" },
  description,
  applicationName: "Postfino",
  authors: [{ name: "Bleibsichtbar LLC", url: SITE_URL }],
  publisher: "Bleibsichtbar LLC",
  category: "Software",
  keywords: ["Social-Media-Planung", "Social-Media-Tool", "Beiträge planen", "Instagram planen", "Redaktionsplan", "Content-Kalender", "Social-Media-Management", "Agentur-Tool", "DSGVO"],
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  openGraph: { title, description, type: "website", locale: "de_DE", siteName: "Postfino" },
  twitter: { card: "summary_large_image", title, description },
  formatDetection: { telephone: false, email: false, address: false },
};
export const viewport: Viewport = { themeColor: "#0047ab" };

// Structured data: describes the product honestly (no ratings/reviews are claimed); prices match the pricing section.
const PLANS = [["Starter", "19"], ["Pro", "59"], ["Agency", "149"]] as const;
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    ORGANIZATION,
    { "@type": "WebSite", "@id": SITE_ID, url: SITE_URL, name: "Postfino", description, inLanguage: "de-DE", publisher: { "@id": ORG_ID } },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#app`,
      name: "Postfino",
      url: SITE_URL,
      image: `${SITE_URL}/opengraph-image.png`,
      publisher: { "@id": ORG_ID },
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Social-Media-Management",
      operatingSystem: "Web",
      inLanguage: "de-DE",
      description,
      featureList: ["Redaktionskalender", "Ideen-Board", "Automatisches Veröffentlichen", "Community-Postfach", "Insights und Berichte", "Freigaben im Team", "Kunden-Workspaces für Agenturen", "KI-Textvorschläge", "Zwei-Faktor-Anmeldung"],
      offers: PLANS.map(([name, price]) => ({ "@type": "Offer", name, price, priceCurrency: "EUR", category: "subscription", url: `${SITE_URL}/#preise` })),
    },
  ],
};

const THEME_INIT = `try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${inter.variable} ${grotesk.variable} ${outfit.variable}`} suppressHydrationWarning>
      <head>
        {/* apply the saved theme (or the system one) before the first paint, so there is no flash */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <JsonLd data={jsonLd} />
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
          Zum Inhalt springen
        </a>
        <SmoothScroll />
        <AnimGate />
        {children}
      </body>
    </html>
  );
}
