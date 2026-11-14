"use client";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { NetworkIcon, NETWORK_NAMES } from "./network-icon";
import { Logo } from "./logo";
import { useTick } from "@/lib/use-tick";

const INNER = ["instagram_business", "linkedin_page", "tiktok", "facebook_page", "youtube"];
const OUTER = ["threads", "pinterest", "x", "bluesky", "mastodon", "google_business"];
const ALL = [...INNER, ...OUTER];

function Ring({ items, radius, duration, reverse = false, size }: { items: string[]; radius: number; duration: number; reverse?: boolean; size: number }) {
  return (
    <div className="orbit-ring absolute top-1/2 left-1/2" style={{ width: radius * 2, height: radius * 2, marginLeft: -radius, marginTop: -radius, animationDuration: `${duration}s`, animationDirection: reverse ? "reverse" : "normal" }}>
      <span className="absolute inset-0 rounded-full border border-dashed border-cobalt/20" />
      {items.map((p, i) => {
        const a = (i / items.length) * Math.PI * 2;
        return (
          <span key={p} className="absolute" style={{ left: Math.round(radius + Math.cos(a) * radius - size / 2), top: Math.round(radius + Math.sin(a) * radius - size / 2) }}>
            <span className="orbit-ring grid place-items-center rounded-2xl bg-white shadow-[0_14px_30px_-12px_rgba(16,40,110,0.45)] ring-1 ring-line" style={{ width: size, height: size, animationDuration: `${duration}s`, animationDirection: reverse ? "normal" : "reverse" }}>
              <NetworkIcon platform={p} badge size={Math.round(size * 0.62)} />
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Networks orbiting the wordmark; a "published" pulse travels from the centre to a network. */
export function Orbit() {
  const t = useTick(1800);
  const p = ALL[t % ALL.length];
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[520px]" aria-hidden>
      <div className="absolute inset-[18%] rounded-full bg-[radial-gradient(circle,rgba(79,141,255,0.22),transparent_70%)]" />
      <div className="absolute inset-0 origin-center scale-[0.62] sm:scale-100">
        <div className="absolute top-1/2 left-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2">
          <Ring items={INNER} radius={150} duration={28} size={58} />
          <Ring items={OUTER} radius={240} duration={42} reverse size={50} />
        </div>
      </div>
      {/* centre */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <span className="orbit-ping absolute inset-0 rounded-[28px] bg-sky/40" />
        <span className="orbit-ping absolute inset-0 rounded-[28px] bg-sky/30 [animation-delay:1.2s]" />
        <div className="relative grid place-items-center rounded-[28px] bg-white px-5 py-5 shadow-[0_30px_60px_-20px_rgba(0,71,171,0.55)] ring-1 ring-line">
          <Logo size={34} />
        </div>
      </div>
      {/* live toast */}
      <div className="absolute inset-x-0 bottom-2 flex justify-center">
        <AnimatePresence mode="wait">
          <motion.span key={t} initial={{ opacity: 0, y: 16, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12, scale: 0.95 }} transition={{ type: "spring", stiffness: 380, damping: 26 }} className="inline-flex items-center gap-2 rounded-full bg-ink py-2 pr-4 pl-2 text-sm font-semibold text-white shadow-xl">
            <NetworkIcon platform={p} badge size={24} />
            {NETWORK_NAMES[p]}
            <span className="grid size-5 place-items-center rounded-full bg-mint">
              <Check className="size-3.5" strokeWidth={3} />
            </span>
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}
