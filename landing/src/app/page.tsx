import type { Metadata } from "next";
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
import { HOME_DESCRIPTION, HOME_TITLE, JsonLd } from "@/lib/seo";

// Home only: canonical and og:url live here so the 404 page does not inherit them.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "de_DE", siteName: "Postfino", url: "/", title: HOME_TITLE, description: HOME_DESCRIPTION },
};

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
      <JsonLd data={faqLd} />
    </>
  );
}
