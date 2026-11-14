"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// WebGL shader is client-only and loaded after the page, so it never blocks first paint.
const NeuroNoise = dynamic(() => import("@paper-design/shaders-react").then((m) => m.NeuroNoise), { ssr: false });

/** Animated "neuro noise" lines behind the closing call to action. Stands still with reduced motion; decorative. */
export function CtaShader({ className = "" }: { className?: string }) {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setStill(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 ${className}`}>
      <NeuroNoise
        colorFront="rgba(220, 232, 255, 1)"
        colorMid="rgba(46, 116, 255, 0.85)"
        colorBack="rgba(7, 13, 36, 1)"
        brightness={0}
        contrast={1}
        scale={0.55}
        speed={still ? 0 : 1}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
    </div>
  );
}
