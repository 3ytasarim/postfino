"use client";
import { useRef, useState } from "react";
import { smoothPath } from "./charts";

export type RhythmPoint = { label: string; short: string; value: number; future: boolean; today: boolean };

/**
 * Publishing rhythm: published posts (solid cobalt area) up to today, scheduled posts (dashed line) after it.
 * Crosshair + tooltip on hover/focus; arrow keys move the crosshair for keyboard users.
 */
export function RhythmChart({ points, labels }: { points: RhythmPoint[]; labels: { published: string; scheduled: string; today: string; posts: string } }) {
  const W = 720;
  const H = 220;
  const PAD = { t: 16, b: 26, l: 0, r: 0 };
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(2, ...points.map((p) => p.value));
  const step = points.length > 1 ? (W - PAD.l - PAD.r) / (points.length - 1) : 0;
  const x = (i: number) => PAD.l + i * step;
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const todayIdx = Math.max(0, points.findIndex((p) => p.today));
  const past = points.slice(0, todayIdx + 1).map((p, i): [number, number] => [x(i), y(p.value)]);
  const future = points.slice(todayIdx).map((p, i): [number, number] => [x(i + todayIdx), y(p.value)]);
  const ticks = [0, Math.round(max / 2), max];
  const labelEvery = Math.ceil(points.length / 8);

  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const i = Math.round(((clientX - r.left) / r.width) * (W / step || 0));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };
  const hp = hover === null ? null : points[hover];

  return (
    <div className="relative">
      <div
        ref={box}
        className="relative outline-none"
        tabIndex={0}
        role="img"
        aria-label={points.map((p) => `${p.label}: ${p.value}`).join(", ")}
        onMouseMove={(e) => pick(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onFocus={() => setHover(todayIdx)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? todayIdx) - 1));
          if (e.key === "ArrowRight") setHover((h) => Math.min(points.length - 1, (h ?? todayIdx) + 1));
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[220px] w-full" aria-hidden>
          <defs>
            <linearGradient id="rhythm-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--takt)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--takt)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <line key={t} x1="0" x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" strokeDasharray={t === 0 ? undefined : "2 5"} vectorEffect="non-scaling-stroke" />
          ))}
          <rect x={x(todayIdx)} y={PAD.t - 6} width={W - x(todayIdx)} height={H - PAD.t - PAD.b + 6} fill="var(--surface-2)" opacity="0.55" />
          <path d={`${smoothPath(past)} L${x(todayIdx)},${y(0)} L${x(0)},${y(0)} Z`} fill="url(#rhythm-fill)" className="rhythm-area" />
          <path d={smoothPath(past)} fill="none" stroke="var(--takt)" strokeWidth="2.25" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="rhythm-line" />
          <path d={smoothPath(future)} fill="none" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <line x1={x(todayIdx)} x2={x(todayIdx)} y1={PAD.t - 6} y2={H - PAD.b} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t - 6} y2={H - PAD.b} stroke="var(--ink)" strokeOpacity="0.35" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* HTML overlays keep text crisp (the SVG stretches horizontally) */}
        <span className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-full bg-ink px-2 py-0.5 text-[0.62rem] font-semibold text-bg" style={{ left: `${(x(todayIdx) / W) * 100}%` }}>
          {labels.today}
        </span>
        {ticks.map((t) => (
          <span key={t} className="pointer-events-none absolute left-0 -translate-y-full pb-0.5 text-[0.62rem] tabular-nums text-ink-3" style={{ top: `${(y(t) / H) * 100}%` }}>
            {t}
          </span>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 || p.today ? (
            <span key={i} className={`pointer-events-none absolute bottom-0 -translate-x-1/2 text-[0.62rem] tabular-nums ${p.today ? "font-bold text-ink" : "text-ink-3"}`} style={{ left: `${(x(i) / W) * 100}%` }}>
              {p.short}
            </span>
          ) : null,
        )}
        {hp && hover !== null && (
          <>
            <span
              className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface"
              style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(hp.value) / H) * 100}%`, background: hp.future ? "var(--ink-2)" : "var(--takt)" }}
            />
            <div
              className="pointer-events-none absolute z-10 min-w-[150px] -translate-x-1/2 rounded-[12px] bg-surface px-3 py-2 text-xs shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)] ring-1 ring-line"
              style={{ left: `clamp(80px, ${(x(hover) / W) * 100}%, calc(100% - 80px))`, top: `calc(${(y(hp.value) / H) * 100}% - 64px)` }}
            >
              <p className="font-semibold">{hp.label}</p>
              <p className="mt-1 flex items-center gap-2 text-ink-2">
                <span className={`size-2 rounded-full ${hp.future ? "bg-ink-2" : "bg-takt"}`} />
                {hp.future ? labels.scheduled : labels.published}: <strong className="tabular-nums text-ink">{hp.value}</strong>
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
