"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { Logo } from "./logo";
import { InductionLink } from "./induction-link";
import { ThemeToggle } from "./theme-toggle";
import { LOGIN_URL, REGISTER_URL } from "@/lib/site";

const LINKS = [
  ["#funktionen", "Funktionen"],
  ["#so-gehts", "So geht's"],
  ["#netzwerke", "Netzwerke"],
  ["#preise", "Preise"],
  ["#faq", "FAQ"],
] as const;

/** Floating glass pill navigation; tightens after scrolling, sliding hover pill, mobile sheet. */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3">
      <motion.nav
        initial={{ y: -40, opacity: 0, width: "min(1180px, 100%)" }}
        animate={{ y: 0, opacity: 1, width: scrolled ? "min(980px, 100%)" : "min(1180px, 100%)" }}
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        className={`flex items-center justify-between gap-3 rounded-full px-3 py-2 transition-colors duration-300 ${scrolled ? "nav-solid" : "border border-transparent bg-transparent"}`}
        aria-label="Hauptnavigation"
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty("--nx", `${e.clientX - box.left}px`);
        }}
      >
        <a href="#top" className="px-2 py-1" aria-label="Postfino – Startseite">
          <Logo size={30} />
        </a>
        <ul className="hidden items-center md:flex" onMouseLeave={() => setHover(null)}>
          {LINKS.map(([href, label]) => (
            <li key={href} className="relative">
              <a href={href} onMouseEnter={() => setHover(href)} className="relative z-[1] block px-3.5 py-2 text-sm font-medium text-ink-2 transition-colors hover:text-ink">
                {label}
              </a>
              {hover === href && <motion.span layoutId="nav-hover" className="absolute inset-0 rounded-full bg-cobalt/[0.07] ring-1 ring-cobalt/10" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            </li>
          ))}
        </ul>
        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <a href={LOGIN_URL} className="inline-flex min-h-12 items-center rounded-full border-[1.5px] border-ink/15 bg-surface px-6 text-[15px] font-bold text-ink transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-ink active:scale-[0.98]">
            Anmelden
          </a>
          <InductionLink href={REGISTER_URL} className="inline-flex min-h-12 items-center rounded-full px-6 text-[15px] font-bold">
            Jetzt starten
          </InductionLink>
        </div>
        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <button onClick={() => setOpen(true)} className="grid size-11 place-items-center rounded-full" aria-label="Menü öffnen" aria-expanded={open}>
            <Menu className="size-5" />
          </button>
        </div>
      </motion.nav>

      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[60] md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-[#0b1020]/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} className="nav-solid absolute inset-x-3 top-3 rounded-[28px] p-4">
              <div className="flex items-center justify-between">
                <Logo size={30} />
                <button onClick={() => setOpen(false)} className="grid size-11 place-items-center rounded-full" aria-label="Menü schließen">
                  <X className="size-5" />
                </button>
              </div>
              <ul className="mt-3 space-y-1">
                {LINKS.map(([href, label]) => (
                  <li key={href}>
                    <a href={href} onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 text-base font-semibold hover:bg-surface">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a href={LOGIN_URL} className="flex min-h-12 items-center justify-center rounded-full border-[1.5px] border-ink/15 bg-surface px-4 text-sm font-semibold hover:border-ink">
                  Anmelden
                </a>
                <InductionLink href={REGISTER_URL} onClick={() => setOpen(false)} className="flex min-h-12 items-center justify-center rounded-full px-4 text-sm font-semibold">
                  Jetzt starten
                </InductionLink>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
