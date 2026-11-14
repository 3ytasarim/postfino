import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { Reveal } from "./reveal";
import { COMPANY, REGISTER_URL } from "@/lib/site";

export function FinalCta() {
  return (
    <section className="px-4 pb-24">
      <Reveal className="mx-auto max-w-6xl">
        <div className="relative overflow-hidden rounded-[36px] bg-[#070d24] px-6 py-12 text-white sm:px-12 md:py-14">
          <div className="aurora" aria-hidden>
            <i />
            <i />
            <i />
          </div>
          <div className="relative grid items-center gap-10 md:grid-cols-[1.3fr_1fr]">
            <div className="text-center md:text-left">
              <h2 className="font-display text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.05] font-bold tracking-[-0.03em]">Bleib sichtbar – ohne jeden Tag daran zu denken.</h2>
              <p className="mt-4 text-lg text-white/70">Plane deine nächsten Wochen in einer Stunde. Postfino erledigt den Rest.</p>
              <a href={REGISTER_URL} className="group mt-8 inline-flex items-center gap-2 rounded-full bg-white px-7 py-4 text-base font-semibold text-ink transition-transform hover:-translate-y-0.5">
                Konto erstellen
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </a>
              <p className="mt-6 text-sm text-white/55">Postfino ist eine Anwendung der {COMPANY}.</p>
            </div>
            <div className="relative mx-auto w-full max-w-[340px]">
              <span className="absolute -inset-3 rounded-[32px] bg-gradient-to-br from-sky/50 to-lilac/50 blur-2xl" aria-hidden />
              <Image src="/brand/mascots-960.webp" alt="Die Postfino-Maskottchen" width={960} height={640} className="float-slow relative h-auto w-full rounded-[26px] ring-1 ring-white/15" sizes="340px" />
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
