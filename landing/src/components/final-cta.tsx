import { ArrowRight } from "lucide-react";
import { Reveal } from "./reveal";
import { CtaShader } from "./cta-shader";
import { InductionLink } from "./induction-link";
import { MascotStage } from "./mascot-stage";
import { REGISTER_URL } from "@/lib/site";
import { MadeBy } from "./made-by";

export function FinalCta() {
  return (
    <section className="px-4 pt-4 pb-16">
      <Reveal className="mx-auto max-w-6xl">
        <div className="relative overflow-hidden rounded-[36px] bg-[#070d24] px-6 dark:ring-1 dark:ring-white/10 py-12 text-white sm:px-12 md:py-14">
          <CtaShader />
          {/* keeps the copy readable over the bright lines */}
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_75%_at_24%_50%,rgba(7,13,36,0.55),rgba(7,13,36,0.08)_75%,transparent)]" />
          <div className="relative grid items-center gap-10 md:grid-cols-[1.2fr_1fr]">
            <div className="text-center md:text-left">
              <h2 className="font-display text-[clamp(1.9rem,3.6vw,3rem)] leading-[1.05] font-bold tracking-[-0.03em]">Bleibsichtbar – ohne jeden Tag daran zu denken.</h2>
              <p className="mt-4 text-lg text-white/70">Plane deine nächsten Wochen in einer Stunde. Postfino erledigt den Rest.</p>
              <InductionLink href={REGISTER_URL} className="group mt-8 inline-flex min-h-14 items-center gap-2 rounded-full px-8 py-4 text-base font-bold">
                Konto erstellen
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </InductionLink>
              <MadeBy tone="dark" className="mt-6" />
            </div>
            <div className="relative mx-auto w-full max-w-[460px]">
              <span className="absolute inset-[12%] rounded-full bg-gradient-to-br from-sky/40 to-lilac/40 blur-3xl" aria-hidden />
              <MascotStage />
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
