import Image from "next/image";

/** Floating pieces cut from the mascot artwork; positions are % of the group image (1064 × 580). */
const LAYERS: { src: string; l: number; t: number; w: number; pw: number; ph: number; fx: string; delay: number }[] = [
  { src: "chat", l: 12.13, t: 22.77, w: 11.07, pw: 118, ph: 105, fx: "m-bob", delay: 0 },
  { src: "heart", l: 64.46, t: 14.75, w: 11.42, pw: 122, ph: 114, fx: "m-bob", delay: -1.4 },
  { src: "share", l: 82.16, t: 24.45, w: 10.51, pw: 112, ph: 110, fx: "m-bob", delay: -2.6 },
  { src: "burstStar", l: 53.74, t: 0.52, w: 6.98, pw: 74, ph: 71, fx: "m-burst", delay: 0 },
  { src: "burstMega", l: 23.06, t: 12.42, w: 4.51, pw: 48, ph: 70, fx: "m-burst", delay: -0.7 },
  { src: "burstBot", l: 0.21, t: 44.5, w: 4.87, pw: 52, ph: 65, fx: "m-burst", delay: -1.3 },
  { src: "burstX", l: 93.72, t: 38.29, w: 5.29, pw: 56, ph: 60, fx: "m-burst", delay: -1.9 },
  { src: "sparkA", l: 7.83, t: 32.08, w: 3.53, pw: 38, ph: 39, fx: "m-twinkle", delay: 0 },
  { src: "sparkB", l: 5.99, t: 84.35, w: 3.17, pw: 34, ph: 36, fx: "m-twinkle", delay: -0.9 },
  { src: "sparkC", l: 93.51, t: 81.24, w: 3.17, pw: 34, ph: 37, fx: "m-twinkle", delay: -1.8 },
];

/** Mascot group without a frame: the group breathes, bubbles bob, bursts pop and sparkles twinkle (CSS only). */
export function MascotStage({ className = "" }: { className?: string }) {
  return (
    <div className={`mascot-stage relative ${className}`}>
      <span aria-hidden className="absolute inset-x-[8%] bottom-[1%] h-[9%] rounded-[50%] bg-[#000]/45 blur-xl" />
      <div className="m-float relative">
        <Image src="/brand/mascots/group.webp" alt="Die Postfino-Maskottchen: Netzwerk-Figuren rund um einen lachenden Stern" width={1064} height={580} sizes="(min-width: 768px) 460px, 90vw" className="m-breathe relative h-auto w-full" />
        {LAYERS.map((x) => (
          <Image
            key={x.src}
            src={`/brand/mascots/${x.src}.webp`}
            alt=""
            aria-hidden
            width={x.pw}
            height={x.ph}
            unoptimized
            className={`${x.fx} absolute h-auto`}
            style={{ left: `${x.l}%`, top: `${x.t}%`, width: `${x.w}%`, animationDelay: `${x.delay}s` }}
          />
        ))}
      </div>
    </div>
  );
}
