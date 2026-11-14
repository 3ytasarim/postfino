/** Postfino wordmark: the name set bold and tight, finished with a cobalt dot (pure type). */
export function Logo({ size = 30, light = false }: { size?: number; light?: boolean }) {
  return (
    <span className="inline-flex items-baseline leading-none" style={{ fontSize: size * 0.82 }} aria-label="Postfino" role="img">
      <span className={`font-sans font-extrabold tracking-[-0.045em] ${light ? "text-white" : "text-ink"}`} aria-hidden>
        Postfino
      </span>
      <span className={`logo-pill ml-[0.06em] inline-block size-[0.26em] rounded-full ${light ? "bg-sky" : "bg-cobalt"}`} aria-hidden />
    </span>
  );
}
