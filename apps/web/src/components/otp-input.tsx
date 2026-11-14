"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import type { FormState } from "@/app/(auth)/actions";

// One box per digit: auto-advance, backspace goes back, paste fills all boxes, submits by itself when complete.
// The success tick only appears after the SERVER accepted the code (never on mere input completion).

const LEN = 6;

export function OtpInput({ action, label, hint, error, verifying, done, next = "/app" }: { action: (s: FormState, fd: FormData) => Promise<FormState>; label: string; hint: string; error: string; verifying: string; done: string; next?: string }) {
  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(action, undefined);
  const [shake, setShake] = useState(false);
  const router = useRouter();
  const ok = state?.ok === true;

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);
  useEffect(() => {
    if (state?.error) {
      setShake(true);
      setDigits(Array(LEN).fill(""));
      refs.current[0]?.focus();
      const t = setTimeout(() => setShake(false), 450);
      return () => clearTimeout(t);
    }
    if (ok) {
      window.dispatchEvent(new Event("sichttakt:auth-success"));
      const t = setTimeout(() => router.push(state?.redirect ?? next), 700);
      return () => clearTimeout(t);
    }
  }, [state, ok, router, next]);

  const set = (next: string[]) => {
    setDigits(next);
    if (next.every((d) => d !== "")) requestAnimationFrame(() => formRef.current?.requestSubmit());
  };
  const onChange = (i: number, v: string) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const n = [...digits];
    n[i] = d;
    set(n);
    if (d && i < LEN - 1) refs.current[i + 1]?.focus();
  };
  const onKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < LEN - 1) refs.current[i + 1]?.focus();
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const p = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LEN);
    if (!p) return;
    e.preventDefault();
    const n = Array(LEN).fill("").map((_, i) => p[i] ?? "");
    set(n);
    refs.current[Math.min(p.length, LEN - 1)]?.focus();
  };

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <input type="hidden" name="code" value={digits.join("")} />
      <fieldset>
        <legend className="label">{label}</legend>
        <div className={`flex gap-2 sm:gap-3 ${shake ? "otp-shake" : ""}`} onPaste={onPaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              value={d}
              onChange={(e) => onChange(i, e.target.value)}
              onKeyDown={(e) => onKey(i, e)}
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              maxLength={1}
              disabled={pending || ok}
              aria-label={`${label} ${i + 1}/${LEN}`}
              className={`otp-box size-12 rounded-[14px] border-2 bg-surface text-center font-display text-2xl font-bold tabular-nums outline-none transition-[border-color,transform,background-color] duration-200 focus:border-takt sm:size-14 ${
                ok ? "border-ok bg-ok-soft text-ok" : state?.error && !d ? "border-bad" : d ? "border-ink" : "border-line"
              }`}
              style={ok ? { transitionDelay: `${i * 45}ms`, transform: "translateY(-2px)" } : undefined}
            />
          ))}
        </div>
      </fieldset>
      <p className="min-h-[1.5rem] text-sm" role="status" aria-live="polite">
        {ok ? (
          <span className="inline-flex items-center gap-2 font-semibold text-ok">
            <span className="otp-tick grid size-6 place-items-center rounded-full bg-ok text-white">
              <Check className="size-4" strokeWidth={3} />
            </span>
            {done}
          </span>
        ) : pending ? (
          <span className="text-ink-2">{verifying}</span>
        ) : state?.error ? (
          <span className="font-medium text-bad">{error}</span>
        ) : (
          <span className="text-ink-3">{hint}</span>
        )}
      </p>
    </form>
  );
}
