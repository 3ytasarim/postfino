"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// "Liquid" theme switch: the new theme spills out of the toggle as an organic blob (View Transitions API).
// Each keyframe is a closed Catmull-Rom path with the same number of curve commands, so the browser can tween it.
// Reduced motion / no View Transitions → short colour cross-fade.

const POINTS = 10;
const FRAMES = 30;
const WOBBLE = 0.24;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function smoothClosedPath(pts: [number, number][]) {
  const n = pts.length;
  const f = (v: number) => v.toFixed(1);
  let d = `M ${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    d += ` C ${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}

function blobFrames(x: number, y: number, w: number, h: number) {
  const far = Math.max(Math.hypot(x, y), Math.hypot(w - x, y), Math.hypot(x, h - y), Math.hypot(w - x, h - y));
  const R = far / (1 - WOBBLE) + 60;
  const phase = Array.from({ length: POINTS }, () => Math.random() * Math.PI * 2);
  const spin = Math.random() * Math.PI * 2;
  const frames: Keyframe[] = [];
  for (let s = 0; s <= FRAMES; s++) {
    const p = s / FRAMES;
    const r = Math.max(2, R * easeInOut(p));
    const t = p * Math.PI * 2.2;
    const pts: [number, number][] = [];
    for (let i = 0; i < POINTS; i++) {
      const a = (i / POINTS) * Math.PI * 2 + spin + p * 0.9;
      const k = 1 + WOBBLE * (0.55 * Math.sin(2 * a + phase[i]! + t) + 0.3 * Math.sin(3 * a - t * 1.4 + phase[(i + 3) % POINTS]!) + 0.15 * Math.sin(5 * a + t * 0.7));
      pts.push([x + Math.cos(a) * r * k, y + Math.sin(a) * r * k]);
    }
    frames.push({ clipPath: `path("${smoothClosedPath(pts)}")` });
  }
  return frames;
}

function liquidSwitch(x: number, y: number, apply: () => void) {
  const root = document.documentElement;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> } };
  if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    root.classList.add("theme-fade");
    apply();
    setTimeout(() => root.classList.remove("theme-fade"), 600);
    return;
  }
  root.classList.add("liquid-switching");
  const vt = doc.startViewTransition(apply);
  vt.ready.then(() => root.animate(blobFrames(x, y, innerWidth, innerHeight), { duration: 1100, easing: "linear", pseudoElement: "::view-transition-new(root)" })).catch(() => {});
  vt.finished.finally(() => root.classList.remove("liquid-switching"));
}

export function ThemeToggle({ labels }: { labels: { light: string; dark: string } }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="btn btn-ghost !min-h-[40px] !px-2.5"
      aria-label={next === "dark" ? labels.dark : labels.light}
      title={next === "dark" ? labels.dark : labels.light}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        liquidSwitch(r.left + r.width / 2, r.top + r.height / 2, () => {
          document.documentElement.dataset.theme = next;
          document.cookie = `st_theme=${next}; path=/; max-age=${365 * 86400}; samesite=lax`;
          setTheme(next);
        });
      }}
    >
      {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}
