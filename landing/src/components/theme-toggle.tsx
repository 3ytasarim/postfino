"use client";
import { useEffect, useState, type MouseEvent } from "react";
import { motion } from "motion/react";
import { Moon, Sun } from "lucide-react";

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };

/** Light/dark switch. The choice is kept in localStorage; without one the system setting applies (see the inline script in the layout). */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    const next = !document.documentElement.classList.contains("dark");
    const apply = () => {
      document.documentElement.classList.toggle("dark", next);
      try {
        localStorage.setItem("theme", next ? "dark" : "light");
      } catch {}
      setDark(next);
    };
    const doc = document as ViewTransitionDoc;
    if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();
    // the new theme grows as a circle out of the switch
    const x = e.clientX || window.innerWidth - 40;
    const y = e.clientY || 40;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    doc.startViewTransition(apply).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 650, easing: "cubic-bezier(0.16, 1, 0.3, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  };

  const on = dark === true;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={on ? "Helles Design aktivieren" : "Dunkles Design aktivieren"}
      aria-pressed={on}
      className={`relative inline-flex h-11 w-[68px] shrink-0 items-center rounded-full bg-surface-2 p-1 ring-1 ring-line transition-colors ${className}`}
    >
      <span className={`flex w-full items-center justify-between px-[7px] ${dark === null ? "opacity-0" : ""}`} aria-hidden>
        <Sun className="size-3.5 text-ink-3" />
        <Moon className="size-3.5 text-ink-3" />
      </span>
      <motion.span
        aria-hidden
        className={`absolute top-1 left-1 grid size-9 place-items-center rounded-full shadow-[0_6px_16px_-6px_rgba(16,40,110,0.55)] ${on ? "bg-[#1b2550] text-[#ffd76a]" : "bg-white text-[#f59e0b]"} ${dark === null ? "opacity-0" : ""}`}
        initial={false}
        animate={{ x: on ? 24 : 0, rotate: on ? 0 : 90 }}
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
      >
        {on ? <Moon className="size-4 fill-current" /> : <Sun className="size-4" />}
      </motion.span>
    </button>
  );
}
