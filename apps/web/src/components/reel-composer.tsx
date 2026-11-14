"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { Film, ImageIcon, Upload, CheckCircle2, AlertCircle } from "lucide-react";
import type { CapabilityState } from "@sichttakt/shared";
import type { Messages } from "@/i18n/de";
import { createReelAction, bakeCoverAction } from "@/app/app/actions";
import { CaptionTools } from "./caption-tools";

type Channel = { id: string; name: string; platform: string; sandbox: boolean; coverState: CapabilityState; reelState: CapabilityState };
type Uploaded = { id: string; status: string; errors: string[]; width: number | null; height: number | null; durationMs: number | null; url: string };
const AUTO: CapabilityState[] = ["supported", "requires_app_review"];

function UploadBox({ label, hint, accept, purpose, icon: Icon, value, onChange }: { label: string; hint: string; accept: string; purpose: "video" | "cover"; icon: typeof Film; value: Uploaded | null; onChange: (u: Uploaded | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  async function pick(file: File) {
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("purpose", purpose);
    const res = await fetch("/app/api/media", { method: "POST", body: fd });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(json.error ?? "Upload fehlgeschlagen");
    onChange({ ...json, url: URL.createObjectURL(file) });
  }
  const ok = value?.status === "ready";
  return (
    <div>
      <p className="label">{label}</p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={`flex w-full items-center gap-4 rounded-[16px] border-2 border-dashed p-4 text-left transition-colors ${ok ? "border-ok/50 bg-ok-soft/40" : "border-line hover:border-takt hover:bg-takt-soft/30"}`}
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-surface-2">{busy ? <Upload className="size-5 animate-pulse" /> : <Icon className="size-5" />}</span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{value ? `${value.width ?? "?"}×${value.height ?? "?"}${value.durationMs ? ` · ${(value.durationMs / 1000).toFixed(1)} s` : ""}` : busy ? "…" : label}</span>
          <span className="block text-xs text-ink-3">{hint}</span>
        </span>
        {ok && <CheckCircle2 className="ml-auto size-5 shrink-0 text-ok" />}
      </button>
      <input ref={input} type="file" accept={accept} className="sr-only" aria-label={label} onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      {(err || (value && value.errors.length > 0)) && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-medium text-bad">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {err ?? value?.errors.join(" · ")}
        </p>
      )}
    </div>
  );
}

function Frame({ ratio, label, src, video, offset }: { ratio: string; label: string; src?: string; video?: string; offset: number }) {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (v.current) v.current.currentTime = offset;
  }, [offset, video]);
  return (
    <figure className="flex flex-col items-center gap-2">
      <div className="relative w-full overflow-hidden rounded-[12px] bg-surface-2 ring-1 ring-line" style={{ aspectRatio: ratio }}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
        ) : video ? (
          <video ref={v} src={video} muted playsInline preload="metadata" className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-ink-3">
            <ImageIcon className="size-6" />
          </div>
        )}
      </div>
      <figcaption className="text-center text-[0.7rem] font-semibold text-ink-3">{label}</figcaption>
    </figure>
  );
}

export function ReelComposer({ channels, defaultWhen, timezoneNote, t, tb, approvalRequired, templates, aiConfigured, tt }: { channels: Channel[]; defaultWhen: string; timezoneNote: string; t: Messages["composer"]; tb: Messages["compose"]; approvalRequired: boolean; templates: { id: string; name: string; kind: string; body: string }[]; aiConfigured: boolean; tt: { ai: Messages["ai"]; ideas: Messages["ideasPage"]; links: Messages["linksPage"] }; }) {
  const [consent, setConsent] = useState(false);
  const [baking, setBaking] = useState(false);
  const [bakeMsg, setBakeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [state, action, pending] = useActionState(createReelAction, undefined);
  const [video, setVideo] = useState<Uploaded | null>(null);
  const [cover, setCover] = useState<Uploaded | null>(null);
  const [coverMode, setCoverMode] = useState<"independent_image" | "video_frame">("independent_image");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>(channels.filter((c) => c.sandbox).map((c) => c.id).slice(0, 1));
  const [mode, setMode] = useState<"automatic" | "notification">("automatic");
  const [caption, setCaption] = useState("");

  const blockedCover = coverMode === "independent_image" && mode === "automatic" && channels.some((c) => selected.includes(c.id) && !AUTO.includes(c.coverState));
  const previewSrc = coverMode === "independent_image" ? cover?.url : undefined;
  const previewVideo = coverMode === "video_frame" ? video?.url : undefined;
  const canSubmit = Boolean(video?.status === "ready" && selected.length && (coverMode === "video_frame" || cover?.status === "ready") && !blockedCover);
  const errorText = state?.error === "dstGap" ? t.dstGap : state?.error;

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[1.25fr_1fr] [&>*]:min-w-0">
      <input type="hidden" name="videoAssetId" value={video?.id ?? ""} />
      <input type="hidden" name="coverAssetId" value={cover?.id ?? ""} />
      <input type="hidden" name="coverMode" value={coverMode} />
      <div className="card space-y-6 p-6">
        <UploadBox label={t.video} hint={t.videoHint} accept="video/mp4,video/quicktime" purpose="video" icon={Film} value={video} onChange={setVideo} />

        <fieldset>
          <legend className="label">{t.coverMode}</legend>
          <div className="grid grid-cols-2 gap-2 rounded-[14px] bg-surface-2 p-1">
            {(["independent_image", "video_frame"] as const).map((m) => (
              <label key={m} className={`flex min-h-[44px] cursor-pointer items-center justify-center rounded-[10px] px-3 text-sm font-semibold ${coverMode === m ? "bg-surface shadow-sm" : "text-ink-2"}`}>
                <input type="radio" name="_coverMode" className="sr-only" checked={coverMode === m} onChange={() => setCoverMode(m)} />
                {m === "independent_image" ? t.coverIndependent : t.coverFrame}
              </label>
            ))}
          </div>
        </fieldset>

        {coverMode === "independent_image" ? (
          <UploadBox label={t.cover} hint={t.coverHint} accept="image/jpeg" purpose="cover" icon={ImageIcon} value={cover} onChange={setCover} />
        ) : (
          <div>
            <label className="label" htmlFor="thumb">
              {t.thumbOffset}: {offset.toFixed(1)} s
            </label>
            <input id="thumb" name="thumbOffset" type="range" min={0} max={Math.max(1, (video?.durationMs ?? 3000) / 1000)} step={0.1} value={offset} onChange={(e) => setOffset(Number(e.target.value))} className="w-full accent-[var(--takt)]" />
          </div>
        )}

        <div>
          <label className="label" htmlFor="caption">
            {t.caption} <span className="font-normal text-ink-3">({caption.length}/2200)</span>
          </label>
          <textarea id="caption" name="caption" rows={5} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} className="input resize-y" />
          <CaptionTools caption={caption} setCaption={setCaption} templates={templates} aiConfigured={aiConfigured} t={tt} />
        </div>

        <fieldset>
          <legend className="label">{t.channels}</legend>
          <div className="space-y-2">
            {channels.map((c) => (
              <label key={c.id} className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-[12px] border border-line px-3">
                <input type="checkbox" name="accountIds" value={c.id} checked={selected.includes(c.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} className="size-4 accent-[var(--takt)]" />
                <span className="flex-1 font-medium">{c.name}</span>
                {c.sandbox && <span className="chip bg-warn-soft text-warn">Sandbox · MOCK</span>}
                <span className="chip bg-surface-2 font-mono text-ink-3" title="reel.independent_cover">
                  cover: {c.coverState}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="when">
              {t.when}
            </label>
            <input id="when" name="when" type="datetime-local" defaultValue={defaultWhen} className="input" />
            <p className="mt-1.5 text-xs text-ink-3">{timezoneNote}</p>
          </div>
          <div>
            <label className="label" htmlFor="mode">
              {t.mode}
            </label>
            <select id="mode" name="publishMode" value={mode} onChange={(e) => setMode(e.target.value as "automatic")} className="input">
              <option value="automatic">{t.automatic}</option>
              <option value="notification">{t.notification}</option>
            </select>
          </div>
        </div>

        {blockedCover && (
          <div className="space-y-3 rounded-[12px] bg-warn-soft px-3 py-3 text-sm text-warn">
            <p className="font-medium">{t.capabilityWarning}</p>
            {video?.status === "ready" && cover?.status === "ready" && (
              <div className="rounded-[10px] bg-surface p-3 text-ink">
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-[var(--takt)]" />
                  {tb.bakeConsent}
                </label>
                <button
                  type="button"
                  className="btn btn-ghost mt-2 !min-h-[38px] text-sm"
                  disabled={!consent || baking}
                  onClick={async () => {
                    setBaking(true);
                    const r = await bakeCoverAction(video.id, cover.id, consent);
                    setBaking(false);
                    if (r?.ok && r.details) {
                      const d = r.details as { id: string; width: number | null; height: number | null; durationMs: number | null };
                      setVideo({ ...video, id: d.id, width: d.width, height: d.height, durationMs: d.durationMs });
                      setCoverMode("video_frame");
                      setOffset(0);
                      setBakeMsg({ ok: true, text: tb.bakeDone });
                    } else setBakeMsg({ ok: false, text: r?.error ?? "Fehler" });
                  }}
                >
                  {baking ? "…" : tb.bake}
                </button>
              </div>
            )}
          </div>
        )}
        {bakeMsg && <p className={`text-sm font-medium ${bakeMsg.ok ? "text-ok" : "text-bad"}`}>{bakeMsg.text}</p>}
        {errorText && (
          <p role="alert" className="rounded-[12px] bg-bad-soft px-3 py-2.5 text-sm font-medium text-bad">
            {errorText}
          </p>
        )}
        {selected.length === 0 && <p className="text-sm text-ink-3">{t.selectChannel}</p>}

        <div className="flex flex-wrap gap-2 border-t border-line pt-5">
          <button name="intent" value="schedule" className="btn btn-primary" disabled={!canSubmit || pending}>
            {pending ? "…" : approvalRequired ? `${t.schedule} → Freigabe` : t.schedule}
          </button>
          <button name="intent" value="draft" className="btn btn-ghost" disabled={!canSubmit || pending}>
            {t.draft}
          </button>
        </div>
      </div>

      <aside className="card h-fit p-6 lg:sticky lg:top-24">
        <h2 className="mb-1 text-lg font-bold">{t.previews}</h2>
        <p className="mb-5 text-xs text-ink-3">{t.previewNote}</p>
        <div className="grid grid-cols-[1.1fr_1fr_1fr] items-start gap-3">
          <Frame ratio="9 / 16" label={t.previewReels} src={previewSrc} video={previewVideo} offset={offset} />
          <Frame ratio="3 / 4" label={t.previewGrid} src={previewSrc} video={previewVideo} offset={offset} />
          <Frame ratio="1 / 1" label={t.previewSquare} src={previewSrc} video={previewVideo} offset={offset} />
        </div>
      </aside>
    </form>
  );
}
