import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SicherheitV2 } from "@/components/legal-v2";
import { LEGAL_V2 } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Sicherheit",
  description: "Hosting in Deutschland, Zugriff auf verbundene Kanäle, öffentliche Freigabelinks und wie Sie Sicherheitsprobleme bei Postfino melden.",
  alternates: { canonical: "/sicherheit" },
};

export default function Page() {
  if (!LEGAL_V2) notFound();
  return <SicherheitV2 />;
}
