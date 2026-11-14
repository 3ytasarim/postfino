import { Nav } from "@/components/nav";
import { Hero } from "@/components/hero";
import { Networks } from "@/components/networks";
import { Features } from "@/components/features";
import { Steps } from "@/components/steps";
import { Showcase } from "@/components/showcase";
import { Trust } from "@/components/trust";
import { Pricing } from "@/components/pricing";
import { Faq } from "@/components/faq";
import { FinalCta } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { FAQ } from "@/lib/faq";

const faqLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
};

export default function Home() {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <Networks />
        <Features />
        <Steps />
        <Showcase />
        <Trust />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
    </>
  );
}
