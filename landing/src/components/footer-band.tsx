"use client";
import { useRef, type PointerEvent } from "react";

/**
 * Dot band of the dithered footer (port of the MIT "Dithered Footer" by @otatechie): a drifting field of
 * dithered dots in the brand blue with "Postfino" cut out; the dots brighten in a circle under the cursor.
 * Pure CSS masks, no images; decorative. Drift and rise are off with prefers-reduced-motion.
 */
export function FooterBand() {
  const field = useRef<HTMLDivElement>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = field.current;
    if (!el || e.pointerType === "touch") return;
    const box = el.getBoundingClientRect();
    el.style.setProperty("--df-x", `${e.clientX - box.left}px`);
    el.style.setProperty("--df-y", `${e.clientY - box.top}px`);
    el.classList.add("df-lit");
  };
  return (
    <div aria-hidden className="df-band" onPointerMove={move} onPointerLeave={() => field.current?.classList.remove("df-lit")}>
      <div ref={field} className="df-field">
        <div className="df-dots" />
      </div>
      <p className="df-mark">Postfino</p>
    </div>
  );
}
