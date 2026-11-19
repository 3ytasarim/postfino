"use client";
import { useEffect, useState, type RefObject } from "react";
import { useReady } from "./use-ready";

/**
 * Counter that advances every `ms` while the tab is visible (and, when `ref` is given, while that element is on screen).
 * Starts after the page has settled; frozen under prefers-reduced-motion.
 */
export function useTick(ms: number, start = 0, ref?: RefObject<Element | null>) {
  const [n, setN] = useState(start);
  const ready = useReady();
  const [seen, setSeen] = useState(!ref);
  useEffect(() => {
    const el = ref?.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  useEffect(() => {
    if (!ready || !seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (!document.hidden) setN((v) => v + 1);
    }, ms);
    return () => window.clearInterval(id);
  }, [ms, ready, seen]);
  return n;
}
