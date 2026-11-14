import { Radio } from "lucide-react";
import { NETWORKS } from "@/lib/site";
import { NETWORK_NAMES, NetworkIcon } from "./network-icon";
import { Orbit } from "./orbit";
import { Eyebrow, Reveal } from "./reveal";

const ROW_A = NETWORKS.slice(0, 6);
const ROW_B = NETWORKS.slice(6);

/** One endless row of network pills; the list is doubled so the loop is seamless. */
function MarqueeRow({ items, duration, reverse = false }: { items: readonly string[]; duration: number; reverse?: boolean }) {
  const row = [...items, ...items, ...items, ...items];
  return (
    <div className="marquee overflow-hidden py-1.5">
      <ul className={`marquee-track gap-3 pr-3 ${reverse ? "reverse" : ""}`} style={{ animationDuration: `${duration}s` }}>
        {row.map((p, i) => (
          <li key={i} aria-hidden={i >= items.length} className="flex items-center gap-2.5 rounded-full bg-white py-2 pr-4 pl-2 shadow-[0_10px_30px_-18px_rgba(16,40,110,0.4)] ring-1 ring-line">
            <NetworkIcon platform={p} badge size={26} />
            <span className="text-sm font-semibold whitespace-nowrap">{NETWORK_NAMES[p] ?? p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Networks section: copy + two counter-running rows of pills on the left, the publishing hub on the right. */
export function Networks() {
  return (
    <section id="netzwerke" className="relative overflow-hidden py-14 sm:py-16" aria-labelledby="netzwerke-title">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 lg:grid-cols-[1fr_1.1fr]">
        <Reveal className="min-w-0">
          <Eyebrow text="Netzwerke" />
          <h2 id="netzwerke-title" className="mt-4 font-display text-[clamp(2rem,4.4vw,3.4rem)] leading-[1.02] font-bold tracking-[-0.03em]">
            Ein Beitrag. <span className="shine">Elf Netzwerke.</span>
          </h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-ink-2">Schreib einmal, passe pro Netzwerk an und lass Postfino zur geplanten Zeit veröffentlichen – über die offiziellen Schnittstellen.</p>
          <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-line">
            <span className="relative grid size-2.5 place-items-center">
              <span className="ping-ring absolute inset-0 rounded-full bg-mint" />
              <span className="size-2.5 rounded-full bg-mint" />
            </span>
            <Radio className="size-4 text-ink-3" /> Veröffentlicht automatisch
          </p>
          <div className="mt-8 space-y-3">
            <MarqueeRow items={ROW_A} duration={30} />
            <MarqueeRow items={ROW_B} duration={34} reverse />
          </div>
        </Reveal>
        <Orbit />
      </div>

      <p className="mx-auto mt-8 max-w-xl px-4 text-center text-xs text-ink-3">
        Markennamen und Logos gehören ihren Inhabern und dienen nur zur Kennzeichnung. Einige Netzwerke schalten Funktionen erst nach ihrer eigenen App-Prüfung frei.
      </p>
    </section>
  );
}
