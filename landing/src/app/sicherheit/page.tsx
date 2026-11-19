import type { Metadata } from "next";
import { JsonLd, pageMeta, subPageLd } from "@/lib/seo";
import { notFound } from "next/navigation";
import { SicherheitV2 } from "@/components/legal-v2";
import { LEGAL_V2 } from "@/lib/legal";

const TITLE = "Sicherheit";
const DESCRIPTION = "Hosting in Deutschland, Zugriff auf verbundene Kanäle, öffentliche Freigabelinks und wie du Sicherheitsprobleme bei Postfino meldest.";
export const metadata: Metadata = pageMeta("/sicherheit", TITLE, DESCRIPTION);

export default function Page() {
  if (!LEGAL_V2) notFound();
  return (
      <>
        <JsonLd data={subPageLd("/sicherheit", TITLE, DESCRIPTION)} />
        <SicherheitV2 />
      </>
    );
}
