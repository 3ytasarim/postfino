/**
 * Postfino wordmark: the name set bold and tight, finished with a cobalt dot that pops in.
 * Pure type, drawn in HTML so it stays crisp and follows the theme.
 * `compact` = "P" in a cobalt tile, for the collapsed sidebar.
 */
export function Logo({ size = 28, compact = false, animated = true }: { size?: number; compact?: boolean; animated?: boolean }) {
  if (compact)
    return (
      <span className="logo-mark inline-flex leading-none" aria-label="Postfino" role="img" style={{ fontSize: size * 0.62 }}>
        <span className={`logo-pill grid size-[1.5em] place-items-center rounded-[0.42em] bg-takt font-sans font-extrabold text-takt-ink ${animated ? "logo-pill-in" : ""}`} aria-hidden>
          P
        </span>
      </span>
    );
  return (
    <span className="logo-mark inline-flex items-baseline leading-none" aria-label="Postfino" role="img" style={{ fontSize: size * 0.82 }}>
      <span className="font-sans font-extrabold tracking-[-0.045em] text-ink" aria-hidden>
        Postfino
      </span>
      <span className={`logo-pill ml-[0.06em] inline-block size-[0.26em] rounded-full bg-takt ${animated ? "logo-pill-in" : ""}`} aria-hidden />
    </span>
  );
}
