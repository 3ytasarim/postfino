import { notFound } from "next/navigation";
import { Construction } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { getMessages } from "@/i18n";
import { requireContext } from "@/lib/server";

// Honest placeholders for modules that are in scope but not built yet (no fake data, no dead buttons).
const MODULES: Record<string, { navKey: "calendar" | "ideas" | "clients" | "media" | "community" | "insights" | "reports" | "startPage"; sprint: number; scope: string[] }> = {
  calendar: { navKey: "calendar", sprint: 2, scope: ["Tag/Woche/Monat/Liste", "Drag & Drop, Bulk-Umplanung", "Wöchentliche Slots je Kanal, Queue pausieren/mischen", "Posting-Ziele & Streaks"] },
  ideas: { navKey: "ideas", sprint: 3, scope: ["Kanban/Galerie", "Tags, Gruppen, Vorlagen", "RSS-Feeds", "AI-Assistent mit Markenstimme (menschliche Freigabe Pflicht)"] },
  clients: { navKey: "clients", sprint: 3, scope: ["Kunden-Freigabeportal", "Versionierung & Kommentare", "Erinnerungen", "Kunde sieht nur eigene Marke"] },
  media: { navKey: "media", sprint: 3, scope: ["Medienbibliothek", "CSV-Bulk-Import mit Zeilenvalidierung", "CSV + ZIP mit Videos/Reels/Karussells", "Idempotenter Import"] },
  community: { navKey: "community", sprint: 4, scope: ["Kommentare je Netzwerk laut Capability-Matrix", "Gespeicherte Antworten, AI-Entwürfe", "Moderationslog & Zuweisung"] },
  insights: { navKey: "insights", sprint: 4, scope: ["Kanal- und Post-Metriken mit Quelle + collectedAt", "Vergleich zum Vorzeitraum", "Nicht verfügbare Metriken als N/A", "AI Takeaways mit Stichprobe"] },
  reports: { navKey: "reports", sprint: 4, scope: ["PDF/CSV/Markdown", "Gebrandete Berichte mit Logo", "Berichts-Jobqueue"] },
  "start-page": { navKey: "startPage", sprint: 5, scope: ["Link-in-Bio-Editor", "Shop Grid", "Eigene Klickstatistik (getrennt von Plattformmetriken)", "Link-Shortener auf eigener Domain"] },
};

export default async function SoonPage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const m = MODULES[module];
  if (!m) notFound();
  await requireContext();
  const { t } = await getMessages();
  return (
    <>
      <PageHeader eyebrow={`${t.soon.title} · ${t.soon.sprint} ${m.sprint}`} title={t.nav[m.navKey]} subtitle={t.soon.body} />
      <section className="card max-w-2xl p-6">
        <Construction className="mb-4 size-8 text-takt" aria-hidden />
        <ul className="space-y-2">
          {m.scope.map((s) => (
            <li key={s} className="flex gap-2 text-ink-2">
              <span className="text-takt">—</span> {s}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
