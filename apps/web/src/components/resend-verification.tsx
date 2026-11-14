"use client";
import { useState, useTransition } from "react";
import { resendVerificationAction } from "@/app/app/actions";

export function ResendVerification({ label, sent, notDelivered }: { label: string; sent: string; notDelivered: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <button
        className="btn btn-ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await resendVerificationAction();
            setMsg(r?.details === false ? notDelivered : sent);
          })
        }
      >
        {label}
      </button>
      {msg && (
        <p role="status" className="mt-2 text-sm text-ink-2">
          {msg}
        </p>
      )}
    </div>
  );
}
