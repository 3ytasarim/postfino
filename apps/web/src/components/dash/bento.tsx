"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { animate, motion, useInView } from "motion/react";

const EASE = [0.16, 1, 0.3, 1] as const;

/** Bento tile: rises in staggered by `i`, lifts on hover, presses on tap. Optional link. */
export function Bento({ i = 0, href, className = "", children, label }: { i?: number; href?: string; className?: string; children: React.ReactNode; label?: string }) {
  const body = (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, ease: EASE, delay: 0.06 * i }}
      whileHover={href ? { y: -4, scale: 1.015 } : undefined}
      whileTap={href ? { scale: 0.985 } : undefined}
      className={`relative h-full overflow-hidden rounded-[28px] ${className}`}
    >
      {children}
    </motion.div>
  );
  return href ? (
    <Link href={href} aria-label={label} className="block h-full rounded-[28px] outline-none focus-visible:ring-2 focus-visible:ring-takt">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Number that counts up from 0 when it scrolls into view (instant under reduced motion). */
export function CountUp({ value, format }: { value: number; format?: "compact" }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true });
  useEffect(() => {
    const el = ref.current;
    if (!el || !seen) return;
    const nf = new Intl.NumberFormat(undefined, format === "compact" ? { notation: "compact", maximumFractionDigits: 1 } : {});
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return void (el.textContent = nf.format(value));
    const c = animate(0, value, { duration: 1.1, ease: EASE, onUpdate: (v) => (el.textContent = nf.format(Math.round(v))) });
    return () => c.stop();
  }, [seen, value, format]);
  return (
    <span ref={ref} className="tabular-nums">
      0
    </span>
  );
}

/** Organic wave contours in the card's top-right corner (two fills + two hairlines); paths draw in. */
export function WaveArt({ tone }: { tone: "sky" | "lilac" }) {
  const c = tone === "sky" ? ["#dbe7ff", "#9dbdff", "#6f9dff"] : ["#e9e4ff", "#c3b8ff", "#9d8bff"];
  return (
    <svg className="wave-art pointer-events-none absolute -top-1 -right-1 h-[150px] w-[150px]" viewBox="0 0 160 160" fill="none" aria-hidden>
      <motion.path initial={{ opacity: 0, x: 24 }} animate={{ opacity: 0.85, x: 0 }} transition={{ duration: 1, ease: EASE, delay: 0.2 }} d="M45 0C70 42 42 70 82 102C122 132 160 108 160 160V0H45Z" fill={c[0]} />
      <motion.path initial={{ opacity: 0, x: 30 }} animate={{ opacity: 0.7, x: 0 }} transition={{ duration: 1.1, ease: EASE, delay: 0.32 }} d="M82 0C106 32 90 60 118 82C144 102 160 90 160 138V0H82Z" fill={c[1]} />
      <motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: EASE, delay: 0.5 }} d="M28 0C50 48 36 80 76 115C116 145 155 128 160 168" stroke={c[2]} strokeWidth="1.2" opacity="0.5" />
      <motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: EASE, delay: 0.65 }} d="M52 0C75 42 61 72 95 103C129 129 155 115 160 148" stroke={c[2]} strokeWidth="1.2" opacity="0.4" />
    </svg>
  );
}

/** Topographic hairlines for the cobalt card; they drift slowly. */
export function TopoArt() {
  return (
    <svg className="topo-art pointer-events-none absolute inset-0 h-full w-full opacity-25" viewBox="0 0 200 200" preserveAspectRatio="none" fill="none" aria-hidden>
      {[55, 95, 135, 175].map((y, i) => (
        <motion.path key={y} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.8, ease: EASE, delay: 0.2 + i * 0.12 }} d={`M-20 ${y} Q ${60 + i * 10} ${y - 40}, ${140 + i * 10} ${y + 10} T ${260 + i * 10} ${y - 10}`} stroke="#fff" strokeWidth="1.2" />
      ))}
    </svg>
  );
}

/** Capsule progress bar (pill inside a pill) that fills in. */
export function Capsule({ pct, active = false, delay = 0 }: { pct: number; active?: boolean; delay?: number }) {
  return (
    <div className={`h-[22px] overflow-hidden rounded-full p-[3px] ${active ? "bg-takt/20" : "bg-white/70 dark:bg-white/10"}`}>
      <motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(8, pct)}%` }} transition={{ duration: 1, ease: EASE, delay }} className={`h-full rounded-full ${active ? "bg-takt" : "bg-ink/80"}`} />
    </div>
  );
}
