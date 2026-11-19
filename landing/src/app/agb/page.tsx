import type { Metadata } from "next";
import { JsonLd, pageMeta, subPageLd } from "@/lib/seo";
import { notFound } from "next/navigation";
import { AgbV2 } from "@/components/legal-v2";
import { LEGAL_V2 } from "@/lib/legal";

const TITLE = "AGB";
const DESCRIPTION = "Allgemeine Geschäftsbedingungen für Postfino: Testzugang, Abonnement, Kündigung, Haftung und Widerrufsbelehrung für Verbraucher.";
export const metadata: Metadata = pageMeta("/agb", TITLE, DESCRIPTION);

export default function Page() {
  if (!LEGAL_V2) notFound();
  return (
      <>
        <JsonLd data={subPageLd("/agb", TITLE, DESCRIPTION)} />
        <AgbV2 />
      </>
    );
}
