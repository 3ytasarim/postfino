"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Messages } from "@/i18n/de";
import { previewImportAction } from "@/app/app/actions-content";

export function ImportUpload({ t }: { t: Messages["mediaPage"] }) {
  const [state, action, pending] = useActionState(previewImportAction, undefined);
  const router = useRouter();
  useEffect(() => {
    if (state?.importId) router.push(`/app/media/import?id=${state.importId}${state.reused ? "&reused=1" : ""}`);
  }, [state, router]);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-3">
      <label className="text-sm font-semibold text-ink-2">
        {t.csvFile}
        <input name="csv" type="file" accept=".csv,text/csv" required className="input mt-1" />
      </label>
      <label className="text-sm font-semibold text-ink-2">
        {t.zipFile}
        <input name="zip" type="file" accept=".zip,application/zip" className="input mt-1" />
      </label>
      <label className="text-sm font-semibold text-ink-2">
        {t.target}
        <select name="target" className="input mt-1" defaultValue="draft">
          <option value="draft">{t.targetDraft}</option>
          <option value="queue">{t.targetQueue}</option>
          <option value="scheduled">{t.targetScheduled}</option>
        </select>
      </label>
      <div className="flex items-center gap-3 sm:col-span-3">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "…" : t.validate}
        </button>
        {state?.error && (
          <p role="alert" className="text-sm font-medium text-bad">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
