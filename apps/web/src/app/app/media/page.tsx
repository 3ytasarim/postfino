import Link from "next/link";
import { Images } from "lucide-react";
import { listMedia } from "@sichttakt/core";
import { PageHeader, Empty } from "@/components/ui";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext } from "@/lib/server";

export const metadata = { title: "Medien" };

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const all = await listMedia(ctx.svc.db, ctx.actor, ctx.workspace.id);
  const filter = sp.kind === "image" || sp.kind === "video" || sp.kind === "rejected" ? sp.kind : "all";
  const rows = all
    .filter((a) => (filter === "all" ? true : filter === "rejected" ? a.status === "rejected" : a.kind === filter && a.status === "ready"))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 300);
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "short" });
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 1024 * 1024 ? 1 : 2)} MB`;
  const tabs = [
    ["all", t.mediaPage.all],
    ["image", t.mediaPage.images],
    ["video", t.mediaPage.videos],
    ["rejected", t.mediaPage.rejected],
  ] as const;
  return (
    <>
      <PageHeader
        title={t.mediaPage.title}
        actions={
          <Link href="/app/media/import" className="btn btn-primary">
            {t.mediaPage.import}
          </Link>
        }
      />
      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-[14px] border border-line bg-surface p-1" aria-label="Filter">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/app/media?kind=${k}`} aria-current={k === filter ? "page" : undefined} className={`flex min-h-[40px] items-center rounded-[10px] px-4 text-sm font-semibold ${k === filter ? "bg-ink text-bg" : "text-ink-2 hover:bg-surface-2"}`}>
            {label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <Empty icon={Images} title={t.common.none} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <tbody className="divide-y divide-line">
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="px-5 py-2.5">
                    <p className="max-w-[320px] truncate font-semibold">{a.originalFilename}</p>
                    {a.validationErrors.length > 0 && <p className="max-w-[420px] truncate text-xs text-bad">{a.validationErrors.join(" · ")}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-3">{a.purpose}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-ink-2">
                    {a.width ? `${a.width}×${a.height}` : "—"}
                    {a.durationMs ? ` · ${(a.durationMs / 1000).toFixed(1)} s` : ""}
                  </td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-ink-2">{mb(a.sizeBytes)}</td>
                  <td className="px-3 py-2.5 text-xs text-ink-3">{df.format(a.createdAt)}</td>
                  <td className="px-5 py-2.5">
                    <span className={`chip ${a.status === "ready" ? "bg-ok-soft text-ok" : a.status === "rejected" ? "bg-bad-soft text-bad" : "bg-surface-2 text-ink-3"}`}>{a.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
