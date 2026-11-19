"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import QRCode from "qrcode";
import type { Messages } from "@/i18n/de";
import { beginTotpAction, confirmTotpAction } from "@/app/app/actions";

/** Turns the otpauth:// URI into an inline SVG QR code (rendered locally, the secret never leaves the browser). */
function TotpQr({ uri, label }: { uri: string; label: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toString(uri, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#0b1020", light: "#ffffff" } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(""));
    return () => {
      alive = false;
    };
  }, [uri]);
  return (
    <div role="img" aria-label={label} className="grid size-48 shrink-0 place-items-center rounded-2xl bg-white p-2 shadow-sm ring-1 ring-line [&>svg]:size-full">
      {svg ? <span className="contents" dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="size-10 animate-pulse rounded-full bg-surface-2" />}
    </div>
  );
}

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
    <form action={confirm} className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <TotpQr uri={secret.uri} label={t.twoFactorScan} />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium text-ink">{t.twoFactorScan}</p>
          <p className="text-xs text-ink-3">{t.twoFactorManual}</p>
          <code className="block break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm tracking-wider select-all">{secret.secret.match(/.{1,4}/g)?.join(" ")}</code>
          <a href={secret.uri} className="inline-block text-xs font-semibold text-takt underline-offset-4 hover:underline">
            otpauth:// Link
          </a>
        </div>
      </div>
      <p className="text-sm text-ink-2">{t.twoFactorCode}</p>
      <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} className="input max-w-48 text-center font-mono text-lg tracking-[0.3em]" aria-label={t.twoFactorConfirm} placeholder="123456" />
      {state?.error && <p className="text-sm font-medium text-bad">{state.error}</p>}
      <button className="btn btn-primary" disabled={confirming}>
        {t.twoFactorConfirm}
      </button>
    </form>
  );
}
