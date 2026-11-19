import { Reveal } from "./reveal";
import { TextRevealFaqs } from "./ui/text-reveal-faqs";
import { FAQ } from "@/lib/faq";
import { CONTACT_EMAIL } from "@/lib/site";

const ITEMS = FAQ.map(([question, answer], i) => ({ id: `faq-${i + 1}`, question, answer }));

export function Faq() {
  return (
    <section id="faq" className="relative py-16 md:py-24">
      <Reveal>
        <TextRevealFaqs
          items={ITEMS}
          title="Häufige Fragen"
          lead="Alles, was du über Postfino wissen musst."
          contact={
            <>
              Keine Antwort gefunden? Schreib unserem{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-cobalt hover:underline dark:text-sky">
                Postfino-Team
              </a>
              .
            </>
          }
        />
      </Reveal>
    </section>
  );
}
