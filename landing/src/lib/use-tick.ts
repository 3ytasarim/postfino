"use client";
import { useEffect, useState } from "react";

/** Counter that advances every `ms` while the tab is visible; frozen under prefers-reduced-motion. */
export function useTick(ms: number, start = 0) {
  const [n, setN] = useState(start);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (!document.hidden) setN((v) => v + 1);
    }, ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return n;
}
