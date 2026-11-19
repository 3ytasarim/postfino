"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Switcher between the legal documents; the active pill glides to the current page. */
export function LegalTabs({ tabs }: { tabs: [string, string][] }) {
  const path = usePathname();
  return (
    <nav aria-label="Rechtliche Dokumente" className="legal-tabs mx-auto flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-full p-1 sm:gap-1 sm:p-1.5">
      {tabs.map(([href, label]) => {
        const on = path === href;
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined} className={`relative inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-[13px] font-semibold sm:px-4 sm:text-sm transition-colors ${on ? "text-white" : "text-ink-2 hover:text-cobalt-2"}`}>
            {on && <motion.span layoutId="legal-tab" className="absolute inset-0 rounded-full bg-cobalt" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <span className="relative">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

const slug = (s: string) =>
  s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type Head = { id: string; text: string };

/** The document body with a sticky contents list (scroll-spy), a reading-progress bar and blocks fading in on scroll. */
export function LegalReader({ children }: { children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [heads, setHeads] = useState<Head[]>([]);
  const [active, setActive] = useState("");

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const hs = [...el.querySelectorAll("h2")];
    hs.forEach((h) => {
      if (!h.id) h.id = slug(h.textContent || "");
    });
    setHeads(hs.map((h) => ({ id: h.id, text: (h.textContent || "").trim() })));

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const blocks = [...el.children] as HTMLElement[];
    let reveal: IntersectionObserver | undefined;
    if (!reduce) {
      el.classList.add("is-armed");
      reveal = new IntersectionObserver(
        (es) =>
          es.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("is-in");
              reveal!.unobserve(e.target);
            }
          }),
        { rootMargin: "0px 0px -8% 0px" },
      );
      blocks.forEach((b) => reveal!.observe(b));
    }

    const onScroll = () => {
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight * 0.6;
      const p = Math.min(1, Math.max(0, (window.innerHeight * 0.4 - r.top) / Math.max(1, total)));
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
      let cur = hs[0]?.id ?? "";
      for (const h of hs) if (h.getBoundingClientRect().top < window.innerHeight * 0.3) cur = h.id;
      setActive(cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      reveal?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <>
      <div aria-hidden className="legal-progress">
        <div ref={bar} />
      </div>
      <div className={`grid gap-10 ${heads.length > 1 ? "lg:grid-cols-[250px_minmax(0,1fr)]" : ""}`}>
        {heads.length > 1 && (
          <aside className="hidden lg:block">
            <nav aria-label="Inhalt" className="legal-toc sticky top-8">
              <p className="mb-3 text-[0.7rem] font-bold tracking-[0.2em] text-ink-3 uppercase">Inhalt</p>
              <ol>
                {heads.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} aria-current={active === h.id ? "true" : undefined} className={active === h.id ? "is-active" : ""}>
                      {h.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
        )}
        <article className="legal-card mx-auto w-full max-w-3xl">
          <div ref={body} className="legal">
            {children}
          </div>
        </article>
      </div>
    </>
  );
}
