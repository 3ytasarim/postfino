// Server-rendered SVG charts for the dashboard: sparkline, donut, heatmap. No chart library, no client JS.
// Marks follow the dataviz rules: thin 2px lines, surface gaps between segments, text in ink tokens, never colour alone.

/** Monotone-ish smoothing: cubic segments with horizontal control points (never overshoots below the baseline). */
export function smoothPath(pts: [number, number][]) {
  const first = pts[0];
  if (!first) return "";
  let d = `M${first[0]},${first[1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  return d;
}

export function Sparkline({ id, values, tone = "takt", height = 40 }: { id: string; values: number[]; tone?: "takt" | "white"; height?: number }) {
  const W = 120;
  const H = height;
  const max = Math.max(1, ...values);
  const empty = values.every((v) => v === 0);
  const pts = values.map((v, i): [number, number] => [(i / Math.max(1, values.length - 1)) * W, H - 3 - (v / max) * (H - 8)]);
  const line = smoothPath(pts);
  const stroke = tone === "white" ? "#ffffff" : "var(--takt)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="spark block w-full" style={{ height: H }} aria-hidden>
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={tone === "white" ? 0.35 : 0.22} />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {empty ? (
        <line x1="0" x2={W} y1={H - 3} y2={H - 3} stroke={stroke} strokeOpacity="0.35" strokeWidth="2" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      ) : (
        <>
          <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#sg-${id})`} />
          <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="spark-line" />
        </>
      )}
    </svg>
  );
}

export type DonutSeg = { key: string; label: string; value: number; color: string };

/** Ring chart with 2px surface gaps between segments; the centre carries the total. */
export function Donut({ segs, total, caption, size = 168 }: { segs: DonutSeg[]; total: number; caption: string; size?: number }) {
  const r = 42;
  const C = 2 * Math.PI * r;
  const gap = segs.length > 1 ? 1.6 : 0;
  let acc = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={`${caption}: ${segs.map((s) => `${s.label} ${s.value}`).join(", ") || "0"}`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="11" />
        {total > 0 &&
          segs.map((s, i) => {
            const len = (s.value / total) * C;
            const el = (
              <circle
                key={s.key}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="11"
                strokeDasharray={`${Math.max(0, len - gap)} ${C}`}
                strokeDashoffset={-acc}
                className="donut-seg"
                style={{ "--i": i } as React.CSSProperties}
              />
            );
            acc += len;
            return el;
          })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <span>
          <span className="block font-display text-3xl font-bold tabular-nums leading-none">{total}</span>
          <span className="mt-1 block text-[0.7rem] text-ink-3">{caption}</span>
        </span>
      </div>
    </div>
  );
}

/** Weekday × 2-hour heatmap. Intensity = share of the max cell; empty cells keep a faint tile so the grid reads. */
export function Heatmap({ grid, rows, cols, label, valueLabel }: { grid: number[][]; rows: string[]; cols: string[]; label: string; valueLabel: (v: number) => string }) {
  const max = Math.max(1, ...grid.flat());
  return (
    <div role="img" aria-label={label} className="w-full">
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `2.2rem repeat(${cols.length}, minmax(0, 1fr))` }}>
        {grid.map((row, r) => (
          <div key={r} className="contents">
            <span className="self-center pr-1 text-[0.68rem] text-ink-3">{rows[r]}</span>
            {row.map((v, c) => (
              <span
                key={c}
                title={`${rows[r]} ${cols[c]}: ${valueLabel(v)}`}
                className="heat-cell h-[22px] rounded-[5px]"
                style={{ background: v === 0 ? "var(--surface-2)" : `color-mix(in srgb, var(--takt) ${Math.round(18 + (v / max) * 82)}%, var(--surface-2))`, "--i": r * cols.length + c } as React.CSSProperties}
              />
            ))}
          </div>
        ))}
        <span />
        {cols.map((c, i) => (
          <span key={c} className="pt-1 text-center text-[0.62rem] tabular-nums text-ink-3">
            {i % 2 === 0 ? c : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
