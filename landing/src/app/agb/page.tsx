import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgbV2 } from "@/components/legal-v2";
import { LEGAL_V2 } from "@/lib/legal";

export const metadata: Metadata = {
  title: "AGB",
  description: "Allgemeine Geschäftsbedingungen für Postfino mit Testzugang, Abonnement, Kündigung und Widerrufsbelehrung für Verbraucher.",
  alternates: { canonical: "/agb" },
};

export default function Page() {
  if (!LEGAL_V2) notFound();
  return <AgbV2 />;
}
