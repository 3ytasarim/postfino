/**
 * "Ein Produkt von bleibsichtbar." – the parent-brand seal. The bleibsichtbar wordmark (lowercase, blue dot) gets a
 * looping "becoming visible" wave across its letters, a radar ping on the dot and a light sweep over the pill.
 * Pure CSS (styles in globals.css under .madeby), so it works in server and client components alike.
 */
const WORD = "bleibsichtbar";

export function MadeBy({
  tone = "light",
  size = "sm",
  pre = "Ein Produkt von",
  suf = "",
  className = "",
}: {
  tone?: "light" | "dark";
  size?: "sm" | "md";
  pre?: string;
  suf?: string;
  className?: string;
}) {
  const label = [pre, "Bleibsichtbar", suf].filter(Boolean).join(" ");
  return (
    <a href="https://bleibsichtbar.com" target="_blank" rel="noopener" aria-label={label} data-tone={tone} data-size={size} className={`madeby ${className}`}>
      {pre && <span className="madeby-pre" aria-hidden>{pre}</span>}
      <span className="madeby-mark" aria-hidden>
        {WORD.split("").map((c, i) => (
          <span key={i} style={{ "--i": i } as React.CSSProperties}>
            {c}
          </span>
        ))}
        <span className="madeby-dot" />
      </span>
      {suf && <span className="madeby-pre" aria-hidden>{suf}</span>}
    </a>
  );
}
