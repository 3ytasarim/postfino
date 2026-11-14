"use client";
import { useActionState, useState } from "react";
import { Sparkles } from "lucide-react";
import { replyCommentAction } from "@/app/app/actions-insights";

export function ReplyBox({
  commentId,
  commentText,
  saved,
  aiConfigured,
  t,
}: {
  commentId: string;
  commentText: string;
  saved: { title: string; body: string }[];
  aiConfigured: boolean;
  t: { reply: string; saved: string; ai: string; label: string };
}) {
  const [state, action, pending] = useActionState(replyCommentAction, undefined);
  const [text, setText] = useState("");
  const [aiNote, setAiNote] = useState(false);
  const [busy, setBusy] = useState(false);
  async function draft() {
    setBusy(true);
    const res = await fetch("/app/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "reply", input: commentText }) });
    if (res.ok && res.body) {
      const r = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await r.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setText(acc.replace(/\n\[\[error:\w+\]\]$/, ""));
      }
      setAiNote(true);
    }
    setBusy(false);
  }
  if (state?.ok) return <p className="text-xs font-semibold text-ok">✓</p>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="commentId" value={commentId} />
      <textarea
        name="text"
        rows={2}
        maxLength={2200}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        aria-label={t.reply}
        className="input text-sm"
      />
      {aiNote && <p className="flex items-center gap-1 text-[0.7rem] font-bold uppercase tracking-wider text-puls"><Sparkles className="size-3" /> {t.label}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary !min-h-[34px] text-xs" disabled={pending || !text.trim()}>
          {t.reply}
        </button>
        {saved.length > 0 && (
          <select aria-label={t.saved} className="input !min-h-[34px] !w-auto text-xs" value="" onChange={(e) => e.target.value && setText(e.target.value)}>
            <option value="">{t.saved}</option>
            {saved.map((s) => (
              <option key={s.title} value={s.body}>
                {s.title}
              </option>
            ))}
          </select>
        )}
        {aiConfigured && (
          <button type="button" onClick={draft} disabled={busy} className="btn btn-ghost !min-h-[34px] text-xs">
            <Sparkles className="size-3.5" /> {busy ? "…" : t.ai}
          </button>
        )}
        {state?.error && <span className="text-xs text-bad">{state.error}</span>}
      </div>
    </form>
  );
}
