import Link from "next/link";
import { Logo } from "./logo";
import { COMPANY, LOGIN_URL, REGISTER_URL } from "@/lib/site";

const COLS = [
  ["Produkt", [["#funktionen", "Funktionen"], ["#netzwerke", "Netzwerke"], ["#preise", "Preise"], ["#faq", "FAQ"]]],
  ["Konto", [[REGISTER_URL, "Konto erstellen"], [LOGIN_URL, "Anmelden"]]],
  ["Rechtliches", [["/impressum", "Impressum"], ["/datenschutz", "Datenschutz"], ["/nutzungsbedingungen", "Nutzungsbedingungen"], ["/datenloeschung", "Datenlöschung"]]],
] as const;

export function Footer() {
  return (
    <footer className="border-t border-line bg-white px-4 pt-16 pb-10">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo size={34} />
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-ink-3">Social-Media-Planung für Selbstständige, Teams und Agenturen. Postfino ist eine Anwendung der {COMPANY}.</p>
        </div>
        {COLS.map(([title, links]) => (
          <nav key={title} aria-label={title}>
            <p className="text-sm font-bold">{title}</p>
            <ul className="mt-4 space-y-1">
              {links.map(([href, label]) => (
                <li key={label}>
                  <Link href={href} className="inline-block py-1.5 text-sm text-ink-2 hover:text-cobalt-2">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <p className="mx-auto mt-14 max-w-6xl border-t border-line pt-6 text-xs text-ink-3">© {new Date().getFullYear()} {COMPANY} · postfino.com · Instagram, Facebook, LinkedIn, TikTok, YouTube und weitere sind Marken ihrer jeweiligen Inhaber.</p>
    </footer>
  );
}
