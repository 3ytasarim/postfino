"use client";
import { useState } from "react";
import { Search } from "lucide-react";
import type { UnsplashPhoto } from "@sichttakt/core";
import { unsplashSearchAction, unsplashImportAction } from "@/app/app/actions-links";
import type { Messages } from "@/i18n/de";

/** Unsplash search with attribution and download tracking (done server-side on import). */
export function UnsplashSearch({ t }: { t: Messages["integrationsPage"] }) {
  const [q, setQ] = useState("");
  const [photos, setPhotos] = useState<UnsplashPhoto[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Record<string, string>>({});
  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          const r = await unsplashSearchAction(q);
          setBusy(false);
          if (r.error) setErr(r.error);
          else setPhotos(r.photos ?? []);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} className="input" placeholder={t.unsplashQuery} aria-label={t.unsplashQuery} required />
        <button className="btn btn-primary" disabled={busy}>
          <Search className="size-4" /> {busy ? "…" : t.unsplash}
        </button>
      </form>
      {err && <p className="mt-2 text-sm font-medium text-bad">{err}</p>}
      {photos && photos.length === 0 && <p className="mt-3 text-sm text-ink-3">{t.unsplashNone}</p>}
      {photos && photos.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((p) => (
            <li key={p.id} className="text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumb} alt={p.description ?? ""} className="aspect-[4/3] w-full rounded-[10px] object-cover" loading="lazy" />
              <p className="mt-1 truncate text-ink-3">
                {t.unsplashBy}{" "}
                <a href={`${p.authorUrl}?utm_source=sichttakt&utm_medium=referral`} target="_blank" rel="noreferrer" className="underline">
                  {p.author}
                </a>
              </p>
              {done[p.id] ? (
                <p className="mt-1 font-medium text-ok">✓ {t.unsplashImported}</p>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost mt-1 !min-h-[32px] w-full text-xs"
                  onClick={async () => {
                    const r = await unsplashImportAction(p.id);
                    if (r.error) setErr(r.error);
                    else setDone((d) => ({ ...d, [p.id]: r.credit ?? "" }));
                  }}
                >
                  {t.unsplashImport}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
