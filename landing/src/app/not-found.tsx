import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";
import { LEGAL_LINKS } from "@/lib/legal";

export const metadata: Metadata = { title: "Seite nicht gefunden", robots: { index: false, follow: true } };

/** Real 404 (HTTP status 404, noindex, no canonical) in the brand look, with ways back into the site. */
export default function NotFound() {
  return (
    <main id="main" className="legal-hero relative isolate grid min-h-dvh place-items-center overflow-hidden px-4 py-16 text-center text-white">
      <div aria-hidden className="legal-hero-glow">
        <i />
        <i />
        <i />
      </div>
      <div className="relative max-w-xl">
        <Link href="/" aria-label="Postfino – Startseite" className="inline-flex">
          <Logo size={34} light />
        </Link>
        <p className="mt-12 font-display text-[clamp(4.5rem,16vw,9rem)] leading-none font-bold tracking-[-0.05em] text-white/90">404</p>
        <h1 className="mt-4 font-display text-[clamp(1.6rem,4vw,2.4rem)] font-bold tracking-[-0.02em]">Diese Seite gibt es nicht.</h1>
        <p className="mt-4 text-lg text-white/75">Vielleicht wurde sie verschoben oder der Link enthält einen Tippfehler.</p>
        <Link href="/" className="group mt-8 inline-flex min-h-12 items-center gap-2 rounded-full bg-white px-6 text-base font-semibold text-cobalt transition-transform hover:-translate-y-0.5">
          <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" /> Zur Startseite
        </Link>
        <nav aria-label="Weitere Seiten" className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-white/70">
          {[["/#funktionen", "Funktionen"], ["/#preise", "Preise"], ...LEGAL_LINKS].map(([href, label]) => (
            <Link key={href} href={href} className="py-1 hover:text-white">
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
