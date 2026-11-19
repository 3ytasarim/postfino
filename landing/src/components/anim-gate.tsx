"use client";
import { useEffect } from "react";

/**
 * Pauses every CSS animation inside a page section while that section is off screen. Looping decorations far below the fold
 * then cost nothing (no style work, no animation events) until the visitor scrolls to them.
 */
export function AnimGate() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>("main > section, main > div, body > footer, main ~ footer")];
    if (!els.length) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle("anim-off", !e.isIntersecting)), { rootMargin: "120px 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
