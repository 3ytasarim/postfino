import Link from "next/link";
import { ArrowUp } from "lucide-react";
import { Logo } from "./logo";
import { FooterBand } from "./footer-band";
import { MadeBy } from "./made-by";
import { LEGAL_LINKS } from "@/lib/legal";
import { COMPANY, CONTACT_EMAIL, LOGIN_URL, REGISTER_URL } from "@/lib/site";

const COLS = [
  ["Produkt", [["/#funktionen", "Funktionen"], ["/#so-gehts", "So geht's"], ["/#netzwerke", "Netzwerke"], ["/#preise", "Preise"], ["/#faq", "FAQ"]]],
  ["Kontakt", [[REGISTER_URL, "Konto erstellen"], [LOGIN_URL, "Anmelden"], [`mailto:${CONTACT_EMAIL}`, "E-Mail schreiben"]]],
  ["Rechtliches", LEGAL_LINKS],
] as const;

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-cobalt/10 bg-[var(--footer-bg)] text-ink">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-10 px-4 pt-14 pb-10 md:grid-cols-[1.6fr_repeat(3,1fr)] md:gap-x-10 md:pt-16 md:pb-12">
        <div className="col-span-2 md:col-span-1">
          <Link href="/#top" aria-label="Postfino – nach oben" className="inline-flex">
            <Logo size={36} />
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-2">Social-Media-Planung für Selbstständige, Teams und Agenturen.</p>
          <MadeBy className="mt-4" />
          <div className="mt-6 flex flex-wrap gap-2">
            <a href={REGISTER_URL} className="inline-flex min-h-11 items-center rounded-full bg-cobalt px-5 text-sm font-semibold text-white shadow-[0_12px_26px_-12px_#0047ab] transition-all hover:-translate-y-0.5 hover:bg-cobalt-2">
              Jetzt starten
            </a>
            <a href={LOGIN_URL} className="inline-flex min-h-11 items-center rounded-full bg-surface/70 px-5 text-sm font-semibold ring-1 ring-cobalt/15 transition-all hover:-translate-y-0.5 hover:bg-surface">
              Anmelden
            </a>
          </div>
        </div>
        {COLS.map(([title, links]) => (
          <nav key={title} aria-label={title}>
            <p className="text-sm font-bold">{title}</p>
            <ul className="mt-4 space-y-1">
              {links.map(([href, label]) => (
                <li key={label}>
                  <Link href={href} className="inline-block py-1.5 text-sm text-ink-2 transition-colors hover:text-cobalt">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="px-4">
        <FooterBand />
      </div>

      <div className="mx-auto mt-8 flex max-w-6xl flex-col gap-3 border-t border-cobalt/10 px-4 py-6 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {new Date().getFullYear()} {COMPANY} · postfino.com · Instagram, Facebook, LinkedIn, TikTok, YouTube und weitere sind Marken ihrer jeweiligen Inhaber.
        </p>
        <Link href="/#top" className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-ink-2 hover:text-cobalt">
          Nach oben <ArrowUp className="size-3.5" />
        </Link>
      </div>
    </footer>
  );
}
