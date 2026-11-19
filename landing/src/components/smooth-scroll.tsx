"use client";
import { useEffect } from "react";
import { useReady } from "@/lib/use-ready";

/**
 * Lenis smooth scrolling (skipped under prefers-reduced-motion); in-page anchors scroll smoothly too.
 * Loaded on demand once the page has settled, so it is not part of the first-load work.
 */
export function SmoothScroll() {
  const ready = useReady();
  useEffect(() => {
    if (!ready || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let lenis: import("lenis").default | undefined;
    let id = 0;
    let gone = false;
    import("lenis").then(({ default: Lenis }) => {
      if (gone) return;
      const l = new Lenis({ duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 4), anchors: { offset: -80 } });
      lenis = l;
      const raf = (t: number) => {
        l.raf(t);
        id = requestAnimationFrame(raf);
      };
      id = requestAnimationFrame(raf);
    });
    return () => {
      gone = true;
      cancelAnimationFrame(id);
      lenis?.destroy();
    };
  }, [ready]);
  return null;
}
