import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { getImport, type ImportRow } from "@sichttakt/core";
import { PageHeader, Notice } from "@/components/ui";
import { ImportUpload } from "@/components/import-upload";
import { getMessages } from "@/i18n";
import { requireContext } from "@/lib/server";
import { commitImportAction } from "../../actions-content";

export const metadata = { title: "Bulk-Import" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ id?: string; reused?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const { t } = await getMessages();
  const imp = sp.id ? await getImport(ctx.svc.db, ctx.actor, sp.id).catch(() => null) : null;
  const rows = (imp?.rows ?? []) as unknown as ImportRow[];
  const s = imp?.summary ?? {};

  return (
    <>
      <Link href="/app/media" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> {t.mediaPage.library}
      </Link>
      <PageHeader
        title={t.mediaPage.import}
        subtitle={t.mediaPage.importHint}
        actions={
          <a href="/app/api/import-template" className="btn btn-ghost">
            <Download className="size-4" /> {t.mediaPage.template}
          </a>
        }
      />
      <section className="card mb-6 p-6">
        <h2 className="mb-4 font-bold">{t.mediaPage.importTitle}</h2>
        <ImportUpload t={t.mediaPage} />
      </section>

      {imp && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
            <h2 className="font-bold">{imp.filename}</h2>
            <span className="chip bg-surface-2 text-ink-2">{s.total} {t.mediaPage.row}</span>
            <span className="chip bg-ok-soft text-ok">OK {s.ok ?? 0}</span>
            <span className="chip bg-puls-soft text-puls">✓ {s.created ?? 0}</span>
            <span className="chip bg-bad-soft text-bad">✗ {s.error ?? 0}</span>
            <span className="chip bg-surface-2 text-ink-3">{imp.target}</span>
            <div className="ml-auto flex gap-2">
              {(s.error ?? 0) > 0 && (
                <a href={`/app/api/import-errors?id=${imp.id}`} className="btn btn-ghost !min-h-[38px] text-sm">
                  <Download className="size-4" /> {t.mediaPage.errorsCsv}
                </a>
              )}
              {(s.ok ?? 0) > 0 && (
                <form action={commitImportAction}>
                  <input type="hidden" name="importId" value={imp.id} />
                  <button className="btn btn-primary !min-h-[38px] text-sm">{t.mediaPage.commit}</button>
                </form>
              )}
            </div>
          </div>
          {sp.reused && (
            <div className="px-6 pt-4">
              <Notice tone="info">{t.mediaPage.reused}</Notice>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.row} className={r.status === "error" ? "bg-bad-soft/30" : ""}>
                    <td className="w-14 px-6 py-2.5 font-mono text-xs text-ink-3">#{r.row}</td>
                    <td className="px-3 py-2.5">
                      <span className={`chip ${r.status === "created" ? "bg-puls-soft text-puls" : r.status === "ok" ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{r.data.type}</td>
                    <td className="max-w-[280px] truncate px-3 py-2.5">{r.data.text || "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-ink-3">{r.data.time ?? ""}</td>
                    <td className="max-w-[160px] truncate px-3 py-2.5 text-xs text-ink-3">{r.data.media.join(", ")}</td>
                    <td className="px-6 py-2.5 text-xs text-bad">
                      {r.errors.join(" · ")}
                      {r.postId && (
                        <Link href={`/app/posts/${r.postId}`} className="font-semibold text-takt">
                          →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
