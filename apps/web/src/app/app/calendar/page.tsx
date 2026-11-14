import { redirect } from "next/navigation";

/** The calendar now lives on /app/publish (Liste | Kalender); keep old links and bookmarks working. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string; d?: string; channel?: string; status?: string }> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.view === "month") q.set("mode", "month");
  if (sp.view === "list") q.set("view", "list");
  const date = sp.date ?? sp.d;
  if (date) q.set("date", date);
  if (sp.channel) q.set("channels", sp.channel);
  const s = q.toString();
  redirect(`/app/publish${s ? `?${s}` : ""}`);
}
