"use client";
import { useActionState, useState, useTransition } from "react";
import type { Messages } from "@/i18n/de";
import { beginTotpAction, confirmTotpAction } from "@/app/app/actions";

export function TotpSetup({ t }: { t: Messages["settings"] }) {
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [pending, start] = useTransition();
  const [state, confirm, confirming] = useActionState(confirmTotpAction, undefined);
  if (state?.ok) return <p className="chip bg-ok-soft text-ok">{t.twoFactorOn}</p>;
  if (!secret)
    return (
      <button
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await beginTotpAction();
            if (r?.secret) setSecret({ secret: r.secret, uri: String(r.details) });
          })
        }
      >
        {t.twoFactorSetup}
      </button>
    );
  return (
    <form action={confirm} className="space-y-3">
      <p className="text-sm text-ink-2">{t.twoFactorSecret}</p>
      <code className="block break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm tracking-wider">{secret.secret.match(/.{1,4}/g)?.join(" ")}</code>
      <a href={secret.uri} className="text-xs font-semibold text-takt underline-offset-4 hover:underline">
        otpauth:// Link
      </a>
      <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} className="input" aria-label={t.twoFactorConfirm} placeholder="123456" />
      {state?.error && <p className="text-sm font-medium text-bad">{state.error}</p>}
      <button className="btn btn-primary" disabled={confirming}>
        {t.twoFactorConfirm}
      </button>
    </form>
  );
}
