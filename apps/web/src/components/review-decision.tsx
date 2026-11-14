"use client";
import { useActionState } from "react";
import type { Messages } from "@/i18n/de";
import { reviewDecisionAction } from "@/app/(public)/review/actions";

/** Readable text on an arbitrary brand colour (WCAG relative luminance; white vs. ink). */
function onColor(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / (0.0098 + 0.05)) ? "#ffffff" : "#111318";
}

export function ReviewDecision({ token, t, accent }: { token: string; t: Messages["review"]; accent?: string }) {
  const [state, action, pending] = useActionState(reviewDecisionAction, undefined);
  if (state?.ok) return <p className="rounded-[14px] bg-ok-soft p-5 font-semibold text-ok" role="status">{t.done}</p>;
  return (
    <form action={action} className="card space-y-4 p-6">
      <input type="hidden" name="token" value={token} />
      <label className="block text-sm font-semibold text-ink-2">
        {t.yourName}
        <input name="name" required maxLength={120} autoComplete="name" className="input mt-1" />
      </label>
      <label className="block text-sm font-semibold text-ink-2">
        {t.comment}
        <textarea name="comment" rows={3} maxLength={4000} className="input mt-1" />
      </label>
      {state?.error && (
        <p role="alert" className="text-sm font-medium text-bad">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button name="decision" value="approved" className="btn btn-primary" disabled={pending} style={accent ? { background: accent, color: onColor(accent), borderColor: accent } : undefined}>
          {t.approve}
        </button>
        <button name="decision" value="changes_requested" className="btn btn-ghost" disabled={pending}>
          {t.changes}
        </button>
      </div>
    </form>
  );
}
