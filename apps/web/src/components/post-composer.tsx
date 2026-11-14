"use client";
import { useActionState, useRef, useState } from "react";
import { Upload, X, Film, ImageIcon } from "lucide-react";
import type { CapabilityState } from "@sichttakt/shared";
import type { Messages } from "@/i18n/de";
import { createGenericPostAction } from "@/app/app/actions";
import { CaptionTools } from "./caption-tools";

type PostKind = "image" | "carousel" | "story" | "text" | "video" | "thread";
export type ComposerChannel = { id: string; name: string; platform: string; sandbox: boolean; caps: Record<string, CapabilityState>; firstComment: CapabilityState };
type Item = { id: string; url: string; kind: "image" | "video"; status: string; errors: string[]; name: string };
const AUTO: CapabilityState[] = ["supported", "requires_app_review"];
const KINDS: PostKind[] = ["image", "carousel", "story", "text", "video", "thread"];

export function PostComposer({
  channels,
  defaultWhen,
  timezoneNote,
  firstCommentAllowed,
  t,
  templates,
  aiConfigured,
  tt,
  initialCaption = "",
}: {
  channels: ComposerChannel[];
  defaultWhen: string;
  timezoneNote: string;
  firstCommentAllowed: boolean;
  t: { compose: Messages["compose"]; composer: Messages["composer"] };
  templates: { id: string; name: string; kind: string; body: string }[]; aiConfigured: boolean; tt: { ai: Messages["ai"]; ideas: Messages["ideasPage"]; links: Messages["linksPage"] };
  initialCaption?: string;
}) {
  const [state, action, pending] = useActionState(createGenericPostAction, undefined);
  const [kind, setKind] = useState<PostKind>("image");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(channels.filter((c) => c.sandbox).map((c) => c.id).slice(0, 1));
  const [timing, setTiming] = useState<"queue" | "exact">("exact");
  const [mode, setMode] = useState<"automatic" | "notification">("automatic");
  const [caption, setCaption] = useState(initialCaption);
  const fileRef = useRef<HTMLInputElement>(null);
  const labels = t.compose.types.split(",");

  const needsMedia = kind !== "text" && kind !== "thread";
  const maxItems = kind === "carousel" ? 10 : 1;
  const accept = kind === "video" ? "video/mp4,video/quicktime" : kind === "story" ? "image/jpeg,video/mp4" : kind === "carousel" ? "image/jpeg,video/mp4" : "image/jpeg,image/png";

  async function upload(files: FileList) {
    setBusy(true);
    setUploadErr(null);
    for (const file of Array.from(files).slice(0, maxItems - items.length)) {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("purpose", file.type.startsWith("video/") ? "video" : "image");
      const res = await fetch("/app/api/media", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) {
        setUploadErr(j.error ?? "Upload fehlgeschlagen");
        continue;
      }
      setItems((cur) => [...cur, { id: j.id, url: URL.createObjectURL(file), kind: file.type.startsWith("video/") ? "video" : "image", status: j.status, errors: j.errors ?? [], name: file.name }]);
    }
    setBusy(false);
  }

  const blocked = channels.filter((c) => selected.includes(c.id) && mode === "automatic" && !AUTO.includes(c.caps[kind] ?? "unsupported"));
  const readyItems = items.filter((i) => i.status === "ready");
  const mediaOk = !needsMedia || (kind === "carousel" ? readyItems.length >= 2 : readyItems.length === 1);
  const canSubmit = selected.length > 0 && mediaOk && blocked.length === 0 && (kind !== "text" || caption.trim().length > 0);

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
      <input type="hidden" name="type" value={kind} />
      <input type="hidden" name="mediaIds" value={readyItems.map((i) => i.id).join(",")} />
      <input type="hidden" name="timing" value={timing} />
      <div className="card space-y-6 p-6">
        <fieldset>
          <legend className="label">{t.compose.type}</legend>
          <div className="grid grid-cols-3 gap-1.5 rounded-[14px] bg-surface-2 p-1 sm:grid-cols-6">
            {KINDS.map((k, i) => (
              <label key={k} className={`flex min-h-[42px] cursor-pointer items-center justify-center rounded-[10px] text-sm font-semibold ${kind === k ? "bg-surface shadow-sm" : "text-ink-2"}`}>
                <input
                  type="radio"
                  className="sr-only"
                  checked={kind === k}
                  onChange={() => {
                    setKind(k);
                    setItems([]);
                  }}
                />
                {labels[i]}
              </label>
            ))}
          </div>
        </fieldset>

        {needsMedia && (
          <div>
            <p className="label">{t.compose.media}</p>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {items.map((it, idx) => (
                <li key={it.id} className={`relative aspect-square overflow-hidden rounded-[12px] ring-1 ${it.status === "ready" ? "ring-line" : "ring-bad"}`}>
                  {it.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.url} alt={it.name} className="size-full object-cover" />
                  ) : (
                    <video src={it.url} muted className="size-full object-cover" />
                  )}
                  <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 text-[0.65rem] font-bold text-white">{idx + 1}</span>
                  <button type="button" onClick={() => setItems((c) => c.filter((x) => x.id !== it.id))} className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/60 text-white" aria-label={t.compose.remove}>
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
              {items.length < maxItems && (
                <li>
                  <button type="button" onClick={() => fileRef.current?.click()} className="grid aspect-square w-full place-items-center rounded-[12px] border-2 border-dashed border-line text-ink-3 hover:border-takt hover:text-takt" aria-label={t.compose.media}>
                    {busy ? <Upload className="size-5 animate-pulse" /> : kind === "video" ? <Film className="size-5" /> : <ImageIcon className="size-5" />}
                  </button>
                </li>
              )}
            </ul>
            <input ref={fileRef} type="file" accept={accept} multiple={kind === "carousel"} className="sr-only" aria-label={t.compose.media} onChange={(e) => e.target.files && upload(e.target.files)} />
            {(uploadErr || items.some((i) => i.errors.length)) && (
              <p role="alert" className="mt-2 text-xs font-medium text-bad">
                {uploadErr ?? items.flatMap((i) => i.errors).join(" · ")}
              </p>
            )}
          </div>
        )}

        <div>
          <label className="label" htmlFor="caption">
            {t.composer.caption} <span className="font-normal text-ink-3">({caption.length})</span>
          </label>
          <textarea id="caption" name="caption" rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} className="input resize-y" />
          <CaptionTools caption={caption} setCaption={setCaption} templates={templates} aiConfigured={aiConfigured} t={tt} />
        </div>

        <fieldset>
          <legend className="label">{t.composer.channels}</legend>
          <div className="space-y-2">
            {channels.map((c) => {
              const st = c.caps[kind] ?? "unsupported";
              const on = selected.includes(c.id);
              return (
                <div key={c.id} className="rounded-[12px] border border-line">
                  <label className="flex min-h-[48px] cursor-pointer items-center gap-3 px-3">
                    <input type="checkbox" name="accountIds" value={c.id} checked={on} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} className="size-4 accent-[var(--takt)]" />
                    <span className="flex-1 font-medium">{c.name}</span>
                    {c.sandbox && <span className="chip bg-warn-soft text-warn">Sandbox · MOCK</span>}
                    <span className={`chip font-mono ${AUTO.includes(st) ? "bg-surface-2 text-ink-3" : "bg-bad-soft text-bad"}`}>{st}</span>
                  </label>
                  {on && (
                    <details className="border-t border-line px-3 py-2">
                      <summary className="cursor-pointer text-xs font-semibold text-ink-2">{t.compose.perChannel}</summary>
                      <div className="mt-2 space-y-2">
                        <textarea name={`caption_${c.id}`} rows={2} placeholder={t.compose.captionOverride} aria-label={`${t.compose.captionOverride} – ${c.name}`} className="input text-sm" />
                        <PlatformFields c={c} t={t.compose} />
                        {firstCommentAllowed && kind !== "story" && (
                          <input
                            name={`fc_${c.id}`}
                            placeholder={`${t.compose.firstComment}${AUTO.includes(c.firstComment) ? "" : ` · ${c.firstComment}`}`}
                            disabled={!AUTO.includes(c.firstComment) && mode === "automatic"}
                            aria-label={`${t.compose.firstComment} – ${c.name}`}
                            className="input text-sm"
                          />
                        )}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="label">{t.composer.when}</legend>
            <div className="mb-2 flex gap-1 rounded-[12px] bg-surface-2 p-1">
              {(["exact", "queue"] as const).map((v) => (
                <button key={v} type="button" onClick={() => setTiming(v)} className={`flex-1 rounded-[9px] px-2 py-2 text-xs font-semibold ${timing === v ? "bg-surface shadow-sm" : "text-ink-2"}`} aria-pressed={timing === v}>
                  {v === "exact" ? t.compose.exactTime : t.compose.queueNext}
                </button>
              ))}
            </div>
            {timing === "exact" && (
              <>
                <input name="when" type="datetime-local" defaultValue={defaultWhen} className="input" aria-label={t.composer.when} />
                <p className="mt-1.5 text-xs text-ink-3">{timezoneNote}</p>
              </>
            )}
          </fieldset>
          <div>
            <label className="label" htmlFor="pmode">
              {t.composer.mode}
            </label>
            <select id="pmode" name="publishMode" value={mode} onChange={(e) => setMode(e.target.value as "automatic")} className="input">
              <option value="automatic">{t.composer.automatic}</option>
              <option value="notification">{t.composer.notification}</option>
            </select>
          </div>
        </div>

        {blocked.length > 0 && (
          <p className="rounded-[12px] bg-warn-soft px-3 py-2.5 text-sm font-medium text-warn">
            {blocked.map((b) => b.name).join(", ")}: {labels[KINDS.indexOf(kind)]} → {t.composer.notification}
          </p>
        )}
        {state?.error && (
          <p role="alert" className="rounded-[12px] bg-bad-soft px-3 py-2.5 text-sm font-medium text-bad">
            {state.error === "dstGap" ? t.composer.dstGap : state.error}
          </p>
        )}
        <div className="flex flex-wrap gap-2 border-t border-line pt-5">
          <button name="intent" value="schedule" className="btn btn-primary" disabled={!canSubmit || pending}>
            {pending ? "…" : t.composer.schedule}
          </button>
          <button name="intent" value="draft" className="btn btn-ghost" disabled={!canSubmit || pending}>
            {t.composer.draft}
          </button>
        </div>
      </div>

      <aside className="card h-fit p-6 lg:sticky lg:top-24">
        <h2 className="mb-4 text-lg font-bold">{t.composer.previews}</h2>
        <div className={`mx-auto overflow-hidden rounded-[14px] bg-surface-2 ring-1 ring-line ${kind === "story" ? "aspect-[9/16] max-w-[220px]" : "aspect-square max-w-[320px]"}`}>
          {readyItems[0] ? (
            readyItems[0].kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={readyItems[0].url} alt="" className="size-full object-cover" />
            ) : (
              <video src={readyItems[0].url} muted controls className="size-full object-cover" />
            )
          ) : (
            <div className="grid size-full place-items-center p-6 text-center text-sm text-ink-3">{kind === "text" ? caption || "—" : <ImageIcon className="size-6" />}</div>
          )}
        </div>
        {kind === "carousel" && readyItems.length > 1 && <p className="mt-2 text-center text-xs text-ink-3">1 / {readyItems.length}</p>}
        {kind !== "story" && kind !== "text" && caption && <p className="mt-4 line-clamp-4 whitespace-pre-wrap text-sm text-ink-2">{caption}</p>}
      </aside>
    </form>
  );
}

/** Platform-specific target options (sent as title_/privacy_/link_ fields). TikTok privacy deliberately has no default. */
function PlatformFields({ c, t }: { c: ComposerChannel; t: Messages["compose"] }) {
  const p = c.platform;
  if (!["youtube", "tiktok", "pinterest", "google_business"].includes(p)) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {(p === "youtube" || p === "pinterest") && <input name={`title_${c.id}`} maxLength={p === "youtube" ? 100 : 100} placeholder={t.pfTitle} aria-label={`${t.pfTitle} – ${c.name}`} className="input text-sm" />}
      {p === "youtube" && (
        <select name={`privacy_${c.id}`} defaultValue="public" aria-label={`${t.pfVisibility} – ${c.name}`} className="input text-sm">
          <option value="public">{t.pfPublic}</option>
          <option value="unlisted">{t.pfUnlisted}</option>
          <option value="private">{t.pfPrivate}</option>
        </select>
      )}
      {p === "tiktok" && (
        <>
          <select name={`privacy_${c.id}`} defaultValue="" required aria-label={`${t.pfVisibility} – ${c.name}`} className="input text-sm">
            <option value="" disabled>
              {t.pfChoose}
            </option>
            <option value="PUBLIC_TO_EVERYONE">{t.pfPublic}</option>
            <option value="MUTUAL_FOLLOW_FRIENDS">{t.pfFriends}</option>
            <option value="FOLLOWER_OF_CREATOR">{t.pfFollowers}</option>
            <option value="SELF_ONLY">{t.pfPrivate}</option>
          </select>
          <p className="text-xs text-ink-3 sm:col-span-2">{t.pfTikTokNote}</p>
        </>
      )}
      {(p === "pinterest" || p === "google_business") && <input name={`link_${c.id}`} type="url" placeholder={t.pfLink} aria-label={`${t.pfLink} – ${c.name}`} className="input text-sm" />}
    </div>
  );
}
