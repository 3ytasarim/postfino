import Link from "next/link";
import { ArrowLeft, CalendarDays, Building2 } from "lucide-react";
import { Logo } from "./logo";
import { Footer } from "./footer";
import { LegalTabs, LegalReader } from "./legal-reader";
import { LEGAL_LINKS, OPERATOR } from "@/lib/legal";

/**
 * Shell for the legal pages: a cobalt header with drifting light, the document switcher, a sticky table of contents with
 * scroll-spy and a reading-progress bar, and the text itself revealed block by block as it scrolls in.
 */
export function LegalPage({ title, lead, updated, children }: { title: string; lead?: string; updated: string; children: React.ReactNode }) {
  const tabs = LEGAL_LINKS.filter(([href]) => !href.includes("#"));
  return (
    <>
      <header className="legal-hero relative isolate overflow-hidden">
        <div aria-hidden className="legal-hero-glow">
          <i />
          <i />
          <i />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 pt-8 pb-14 sm:pb-20">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" aria-label="Postfino – Startseite" className="legal-fade">
              <Logo size={30} light />
            </Link>
            <Link href="/" className="legal-fade group inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white">
              <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" /> Zur Startseite
            </Link>
          </div>

          <p className="legal-fade legal-eyebrow mt-14 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.7rem] font-bold tracking-[0.2em] text-white uppercase" style={{ animationDelay: "80ms" }}>
            <span aria-hidden className="relative grid size-2 place-items-center">
              <span className="legal-eyebrow-ping absolute inset-0 rounded-full bg-[#7fb2ff]" />
              <span className="relative size-2 rounded-full bg-[#7fb2ff]" />
            </span>
            Rechtliches
          </p>
          <h1 className="legal-title mt-5 max-w-4xl font-display text-[clamp(2.2rem,6vw,4.4rem)] leading-[1.02] font-bold tracking-[-0.03em] break-words hyphens-auto text-white">
            {title.split(" ").map((w, i) => (
              <span key={i} className="legal-word" style={{ animationDelay: `${160 + i * 70}ms` }}>
                {w}{" "}
              </span>
            ))}
          </h1>
          {lead && (
            <p className="legal-fade mt-5 max-w-2xl text-lg leading-relaxed text-white/75" style={{ animationDelay: "380ms" }}>
              {lead}
            </p>
          )}
          <div className="legal-fade mt-7 flex flex-wrap gap-2 text-sm text-white/85" style={{ animationDelay: "480ms" }}>
            <span className="legal-chip">
              <CalendarDays className="size-4" aria-hidden /> Stand: {updated}
            </span>
            <span className="legal-chip">
              <Building2 className="size-4" aria-hidden /> {OPERATOR.name}
            </span>
          </div>
        </div>
      </header>

      <div className="relative -mt-7 px-4">
        <LegalTabs tabs={tabs} />
      </div>

      <main id="main" className="mx-auto max-w-6xl px-4 pt-10 pb-20">
        <LegalReader>{children}</LegalReader>
      </main>
      <Footer />
    </>
  );
}

/** Marks an operator detail that still has to be filled in before go-live. */
export function Todo({ children }: { children: React.ReactNode }) {
  return <mark className="rounded bg-[#fff4cc] px-1 text-[#0b1020]">[{children}]</mark>;
}
