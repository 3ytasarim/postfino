"use client";
import { useEffect, useState } from "react";

/**
 * Spots behind the crowd where the "Postfino." sign can come up: x = centre (% of group width),
 * line = where the sign is clipped (% of group height), just under the head of the figure in front of it.
 */
const SPOTS = [
  { x: 50, line: 28, tilt: -1 }, // behind the star
  { x: 26, line: 40, tilt: 1 }, // behind Instagram
  { x: 78, line: 40, tilt: -1 }, // behind LinkedIn
];

/** Raised from a random spot (never the same twice in a row), waved, lowered again. */
export function MascotSign() {
  const [spot, setSpot] = useState(0);
  const [up, setUp] = useState(false);
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduce(true);
      setUp(true);
      return;
    }
    let alive = true;
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>((r) => timers.push(window.setTimeout(r, ms)));
    (async () => {
      let cur = 0;
      await wait(1200);
      while (alive) {
        setUp(true);
        await wait(3400);
        if (!alive) break;
        setUp(false);
        await wait(900 + Math.random() * 1400);
        let next = cur;
        while (next === cur) next = Math.floor(Math.random() * SPOTS.length);
        cur = next;
        setSpot(next); // swapped while the sign is down, so it never jumps visibly
        await wait(60);
      }
    })();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, []);

  const s = SPOTS[reduce ? 0 : spot]!;
  return (
    <div aria-hidden className="pointer-events-none absolute w-[34%] overflow-hidden" style={{ left: `${s.x - 17}%`, top: "-60%", height: `${60 + s.line}%` }}>
      <div className={`m-sign ${up ? "is-up" : ""}`} style={{ "--tilt": s.tilt } as React.CSSProperties}>
        <div className="m-sign-wave">
          <div className="m-sign-board">
            <span className="m-sign-word">Postfino</span>
            <span className="m-sign-dot" />
          </div>
          <span className="m-sign-stick" />
        </div>
      </div>
    </div>
  );
}
