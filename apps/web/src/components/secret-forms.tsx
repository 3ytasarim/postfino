"use client";
import { useActionState, useState } from "react";
import { Copy, Check } from "lucide-react";
import type { ActionResult } from "@/app/app/actions";

export function SecretReveal({ secret, note }: { secret: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 rounded-[14px] border border-takt/40 bg-takt-soft p-4" role="status">
      <p className="mb-2 text-sm font-semibold">{note}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-surface px-3 py-2 font-mono text-xs">{secret}</code>
        <button
          type="button"
          className="btn btn-ghost !min-h-[38px] !px-2.5"
          onClick={() => {
            navigator.clipboard.writeText(secret);
            setCopied(true);
          }}
          aria-label="Kopieren"
        >
          {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}

/** Generic form whose server action may return a one-time secret. */
export function SecretForm({
  action,
  children,
  submit,
  secretNote,
  className,
  submitClassName = "btn btn-primary mt-4",
}: {
  action: (s: ActionResult, fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submit: string;
  secretNote: string;
  className?: string;
  submitClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && (
        <p role="alert" className="mt-3 rounded-[12px] bg-bad-soft px-3 py-2 text-sm font-medium text-bad">
          {state.error}
        </p>
      )}
      <button className={submitClassName} disabled={pending}>
        {pending ? "…" : submit}
      </button>
      {state?.secret && <SecretReveal secret={state.secret} note={secretNote} />}
    </form>
  );
}
