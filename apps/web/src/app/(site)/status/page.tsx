import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { systemStatus } from "@sichttakt/core";
import { getMessages, intlLocale } from "@/i18n";
import { services } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Systemstatus", robots: { index: true, follow: true } };

// Public status page. Shows only aggregate system health — no tenant data.
export default async function StatusPage() {
  const { t, locale } = await getMessages();
  const s = t.statusPage;
  const st = await systemStatus(services().db);
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "medium" });
  const banner = {
    operational: { cls: "bg-ok-soft text-ok", Icon: CheckCircle2, text: s.operational },
    degraded: { cls: "bg-warn-soft text-warn", Icon: AlertTriangle, text: s.degraded },
    down: { cls: "bg-bad-soft text-bad", Icon: XCircle, text: s.down },
  }[st.overall];
  const row = (label: string, ok: boolean | null, detail: React.ReactNode) => (
    <li className="flex items-center justify-between gap-4 py-4">
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-3 text-sm">
        <span className="text-ink-3">{detail}</span>
        <span className={`chip ${ok === null ? "bg-surface-2 text-ink-3" : ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{ok === null ? "—" : ok ? s.ok : s.notOk}</span>
      </span>
    </li>
  );
  const anyWorker = st.workers.some((w) => w.ok);
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold">{s.title}</h1>
      <div role="status" className={`mt-6 flex items-center gap-3 rounded-[16px] px-5 py-4 text-lg font-semibold ${banner.cls}`}>
        <banner.Icon className="size-6" aria-hidden /> {banner.text}
      </div>
      <ul className="card mt-6 divide-y divide-line px-6">
        {row(s.db, st.db, "")}
        {row(s.workers, st.db ? anyWorker : null, st.workers.length === 0 ? s.noWorkers : `${st.workers.filter((w) => w.ok).length} / ${st.workers.length}`)}
        {row(s.backlog, st.backlog === null ? null : st.backlog <= 50, st.backlog ?? "—")}
        {row(s.dead, st.dead === null ? null : st.dead === 0, st.dead ?? "—")}
      </ul>
      {st.workers.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs text-ink-3">
          {st.workers.map((w, i) => (
            <li key={i}>
              Worker {i + 1} · {s.lastSeen}: {df.format(w.lastSeenAt)} {w.ok ? "" : `(${s.notOk})`}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-sm text-ink-3">
        {s.checked}: {df.format(new Date())}. {s.note}
      </p>
    </div>
  );
}
