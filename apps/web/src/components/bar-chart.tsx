"use client";
import { useState } from "react";

/** Single-series daily bar chart: thin bars, 4px rounded tops anchored to the baseline, recessive grid,
 *  hover tooltip with hit areas wider than the marks. Colour from the validated --chart-1 token. */
export function BarChart({ data, label, locale, emptyText }: { data: { day: string; value: number }[]; label: string; locale: string; emptyText: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <p className="py-10 text-center text-sm text-ink-3">{emptyText}</p>;
  const W = 640;
  const H = 180;
  const pad = { l: 36, r: 8, t: 12, b: 24 };
  const max = Math.max(...data.map((d) => d.value), 1);
  const nice = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / nice) * nice;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const step = iw / data.length;
  const bw = Math.max(2, Math.min(18, step - 2)); // 2px surface gap between bars
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const nf = new Intl.NumberFormat(locale);
  const df = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const ticks = [0, top / 2, top];
  const h = hover !== null ? data[hover] : null;
  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label}: ${data.map((d) => `${d.day} ${d.value}`).join(", ")}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)">
              {nf.format(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * step + (step - bw) / 2;
          const yy = y(d.value);
          const hgt = Math.max(0, pad.t + ih - yy);
          const r = Math.min(4, bw / 2, hgt);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * step} y={pad.t} width={step} height={ih} fill="transparent" />
              <path d={`M${x},${pad.t + ih} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${pad.t + ih} Z`} fill="var(--chart-1)" opacity={hover === null || hover === i ? 1 : 0.45} />
            </g>
          );
        })}
        {[0, Math.floor((data.length - 1) / 2), data.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
          <text key={i} x={pad.l + i * step + step / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
            {df.format(new Date(`${data[i]!.day}T00:00:00Z`))}
          </text>
        ))}
      </svg>
      {h && (
        <div role="tooltip" className="pointer-events-none absolute top-0 rounded-[10px] border border-line bg-surface px-3 py-2 text-xs shadow-lg" style={{ left: `${((pad.l + hover! * step) / W) * 100}%` }}>
          <p className="text-ink-3">{df.format(new Date(`${h.day}T00:00:00Z`))}</p>
          <p className="font-semibold text-ink">
            {label}: {nf.format(h.value)}
          </p>
        </div>
      )}
    </figure>
  );
}
