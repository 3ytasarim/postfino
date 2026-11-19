"use client";
import { useEffect, useState } from "react";

// Decorative loops start once the page has settled (1.5 s after load) or as soon as the visitor interacts,
// so hydration and the first paint are not competing with animation timers.
let ready = false;
let armed = false;
const subs = new Set<() => void>();

function arm() {
  if (armed) return;
  armed = true;
  const go = () => {
    if (ready) return;
    ready = true;
    subs.forEach((f) => f());
    subs.clear();
  };
  const later = () => window.setTimeout(go, 1500);
  if (document.readyState === "complete") later();
  else window.addEventListener("load", later, { once: true });
  for (const e of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(e, go, { once: true, passive: true });
}

export function useReady() {
  const [r, setR] = useState(ready);
  useEffect(() => {
    if (ready) return setR(true);
    arm();
    const f = () => setR(true);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return r;
}
