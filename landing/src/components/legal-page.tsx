import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "./logo";
import { Footer } from "./footer";

/** Shell for legal pages (Impressum, Datenschutz, Nutzungsbedingungen, Datenlöschung). */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <main id="main" className="mx-auto max-w-3xl px-4 py-16">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" aria-label="Postfino – Startseite">
            <Logo size={30} />
          </Link>
          <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink-2 hover:text-cobalt-2">
            <ArrowLeft className="size-4" /> Zur Startseite
          </Link>
        </div>
        <h1 className="mt-14 font-display text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-3 text-sm text-ink-3">Stand: {updated}</p>
        <div className="legal mt-10">{children}</div>
      </main>
      <Footer />
    </>
  );
}

/** Marks an operator detail that still has to be filled in before go-live. */
export function Todo({ children }: { children: React.ReactNode }) {
  return <mark className="rounded bg-[#fff4cc] px-1 text-ink">[{children}]</mark>;
}
