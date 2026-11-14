"use client";
import { useActionState, useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import type { FormState } from "@/app/(auth)/actions";

/** "Send again" with a countdown until the server allows the next mail (resend throttle). */
export function CodeResend({ action, resendAt, l }: { action: (s: FormState) => Promise<FormState>; resendAt: string; l: { resend: string; resendIn: string; sent: string; tooSoon: string } }) {
  const [state, run, pending] = useActionState(action, undefined);
  const [until, setUntil] = useState(() => new Date(resendAt).getTime());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (state?.ok) setUntil(Date.now() + 45_000);
  }, [state]);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <form action={run} className="text-center text-sm">
      <button disabled={left > 0 || pending} className="inline-flex items-center gap-1.5 font-semibold text-white underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-white/50 disabled:no-underline">
        <RotateCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
        {left > 0 ? l.resendIn.replace("{s}", String(left)) : l.resend}
      </button>
      {state?.ok && <p className="mt-1 text-xs text-white/70">{l.sent}</p>}
      {state?.error === "tooSoon" && <p className="mt-1 text-xs text-[#fecaca]">{l.tooSoon}</p>}
    </form>
  );
}
