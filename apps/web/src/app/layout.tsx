import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { cookies } from "next/headers";
import { getLocale } from "@/i18n";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin", "latin-ext"], variable: "--font-grotesk", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Postfino — by Bleibsichtbar LLC", template: "%s · Postfino" },
  description: "Social-Media-Planung für Agenturen und Marken: Reels mit eigenem Cover, Freigaben, Public API.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f6f5f1" }, { media: "(prefers-color-scheme: dark)", color: "#0c0d10" }] };

// Theme: cookie "st_theme" = light | dark | system. "system" resolves before paint via inline script (no flash).
const themeScript = `(()=>{try{var m=document.cookie.match(/(?:^|; )st_theme=([^;]+)/);var t=m?m[1]:'system';if(t==='system'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const theme = (await cookies()).get("st_theme")?.value;
  return (
    // translate="no": the app ships its own DE/EN/TR UI. Browser auto-translation (Google Translate) rewrites
    // text nodes behind React's back and crashes client components ("removeChild … not a child of this node").
    <html lang={locale} translate="no" data-theme={theme === "dark" || theme === "light" ? theme : undefined} className={`${inter.variable} ${grotesk.variable}`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
