"use client";
import { useState } from "react";
import { Sparkles, FileText, Link2 } from "lucide-react";
import { applyUtmToText } from "@sichttakt/shared";
import { shortenCaptionAction } from "@/app/app/actions-links";
import type { Messages } from "@/i18n/de";

type Template = { id: string; name: string; kind: string; body: string };
const TASKS = ["rewrite", "shorten", "expand", "translate", "adapt", "headlines", "hashtags"] as const;

/** Template insert, AI assistant (suggestion only, never auto-applied) and UTM tagging for a caption field. */
export function CaptionTools({
  caption,
  setCaption,
  templates,
  aiConfigured,
  t,
}: {
  caption: string;
  setCaption: (v: string) => void;
  templates: Template[];
  aiConfigured: boolean;
  t: { ai: Messages["ai"]; ideas: Messages["ideasPage"]; links: Messages["linksPage"] };
}) {
  const [open, setOpen] = useState<"ai" | "tpl" | "utm" | null>(null);
  const [task, setTask] = useState<(typeof TASKS)[number]>("rewrite");
  const [language, setLanguage] = useState("en");
  const [platform, setPlatform] = useState("Instagram");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [utm, setUtm] = useState({ source: "instagram", medium: "social", campaign: "" });
  const taskLabels = t.ai.tasks.split(",");
  const [shortBusy, setShortBusy] = useState(false);
  const [shortErr, setShortErr] = useState<string | null>(null);
  const hasUrl = /https?:\/\//.test(caption);
  async function shorten(provider: "own" | "bitly") {
    setShortBusy(true);
    setShortErr(null);
    const r = await shortenCaptionAction(caption, provider);
    setShortBusy(false);
    if (r.error) setShortErr(r.error);
    else if (r.text !== undefined) setCaption(r.text);
  }

  async function run() {
    setBusy(true);
    setErr(null);
    setOut("");
    try {
      const res = await fetch("/app/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, input: caption, language, platform }) });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        const m = /\n\[\[error:(\w+)\]\]$/.exec(acc);
        if (m) {
          setErr(m[1]!);
          acc = acc.slice(0, m.index);
        }
        setOut(acc);
      }
    } finally {
      setBusy(false);
    }
  }

  const tab = (k: "ai" | "tpl" | "utm", icon: React.ReactNode, label: string) => (
    <button type="button" onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k} className={`btn !min-h-[34px] !px-3 text-xs ${open === k ? "bg-ink text-bg" : "btn-ghost"}`}>
      {icon} {label}
    </button>
  );

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1.5">
        {tab("ai", <Sparkles className="size-3.5" />, t.ai.title)}
        {templates.length > 0 && tab("tpl", <FileText className="size-3.5" />, t.ideas.templates)}
        {tab("utm", <Link2 className="size-3.5" />, t.ai.utm)}
      </div>

      {open === "ai" && (
        <div className="mt-2 space-y-2 rounded-[12px] border border-line bg-bg p-3">
          {!aiConfigured ? (
            <p className="text-xs font-medium text-warn">{t.ai.notConfigured}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <select value={task} onChange={(e) => setTask(e.target.value as (typeof TASKS)[number])} className="input !min-h-[36px] !w-auto text-sm" aria-label={t.ai.task}>
                  {TASKS.map((k, i) => (
                    <option key={k} value={k}>
                      {taskLabels[i]}
                    </option>
                  ))}
                </select>
                {task === "translate" && (
                  <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input !min-h-[36px] !w-auto text-sm" aria-label={t.ai.language}>
                    <option value="de">Deutsch</option>
                    <option value="en">English</option>
                    <option value="tr">Türkçe</option>
                  </select>
                )}
                {task === "adapt" && (
                  <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="input !min-h-[36px] !w-auto text-sm" aria-label={t.ai.platform}>
                    {["Instagram", "Facebook", "LinkedIn", "TikTok", "X", "Threads"].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                )}
                <button type="button" onClick={run} disabled={busy || !caption.trim()} className="btn btn-primary !min-h-[36px] text-sm">
                  {busy ? "…" : t.ai.run}
                </button>
              </div>
              {err && <p className="text-xs font-medium text-bad">{err}</p>}
              {out && (
                <div className="rounded-[10px] border border-puls/40 bg-puls-soft/40 p-3">
                  <p className="mb-1 flex items-center gap-1 text-[0.7rem] font-bold uppercase tracking-wider text-puls">
                    <Sparkles className="size-3" /> {t.ai.label}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{out}</p>
                  {!busy && (
                    <div className="mt-2 flex gap-2">
                      <button type="button" className="btn btn-ghost !min-h-[32px] text-xs" onClick={() => setCaption(out)}>
                        {t.ai.apply}
                      </button>
                      <button type="button" className="btn btn-ghost !min-h-[32px] text-xs" onClick={() => setCaption(`${caption}\n\n${out}`)}>
                        {t.ai.append}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {open === "tpl" && (
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-[12px] border border-line bg-bg p-2">
          {templates.map((tp) => (
            <li key={tp.id} className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 hover:bg-surface-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                <strong>{tp.name}</strong> <span className="text-xs text-ink-3">{tp.kind}</span>
              </span>
              <button type="button" className="btn btn-ghost !min-h-[30px] text-xs" onClick={() => setCaption(caption ? `${caption}\n\n${tp.body}` : tp.body)}>
                {t.ideas.insert}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open === "utm" && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-[12px] border border-line bg-bg p-3">
          {(["source", "medium", "campaign"] as const).map((k) => (
            <label key={k} className="text-xs text-ink-2">
              utm_{k}
              <input value={utm[k]} onChange={(e) => setUtm({ ...utm, [k]: e.target.value })} className="input !min-h-[34px] !w-36 text-sm" />
            </label>
          ))}
          <button type="button" className="btn btn-ghost !min-h-[34px] text-xs" disabled={!utm.campaign.trim()} onClick={() => setCaption(applyUtmToText(caption, utm))}>
            {t.ai.utmApply}
          </button>
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden />
          <button type="button" className="btn btn-ghost !min-h-[34px] text-xs" disabled={!hasUrl || shortBusy} title={t.links.shortenHint} onClick={() => shorten("own")}>
            {shortBusy ? "…" : t.links.shorten}
          </button>
          <button type="button" className="btn btn-ghost !min-h-[34px] text-xs" disabled={!hasUrl || shortBusy} onClick={() => shorten("bitly")}>
            {t.links.bitly}
          </button>
          {shortErr && <p className="w-full text-xs font-medium text-bad">{shortErr}</p>}
        </div>
      )}
    </div>
  );
}
