"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { FormState } from "@/app/(auth)/actions";

// Liquid OTP (after the "liquid-otp-v2" reference): every typed digit fills its box with rising cobalt water,
// boxes tilt while the server checks, and on success they merge into one green drop with a tick. Wrong codes shake
// and drain. The tick only appears after the SERVER accepted the code.

const LEN = 6;
const BOX = 52;
const GAP = 10;

function Water({ on }: { on: boolean }) {
  return (
    <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[14px]" aria-hidden>
      <motion.span className="lq-fill absolute inset-0" initial={{ y: "100%" }} animate={{ y: on ? "18%" : "100%" }} transition={{ type: "spring", stiffness: 140, damping: 14, mass: 1 }}>
        <span className="lq-wave" />
        {on && (
          <span className="absolute inset-0">
            {[18, 46, 70, 32].map((left, i) => (
              <span key={i} className="lq-bubble" style={{ left: `${left}%`, width: 4 + (i % 3) * 2, height: 4 + (i % 3) * 2, animationDelay: `${i * 0.35}s`, animationDuration: `${1.6 + i * 0.3}s` }} />
            ))}
          </span>
        )}
      </motion.span>
      <motion.span className="absolute inset-0 bg-gradient-to-br from-white/50 via-transparent to-transparent" animate={{ opacity: on ? 1 : 0 }} />
    </span>
  );
}

export function LiquidOtp({
  action,
  label,
  hint,
  errors,
  verifying,
  done,
  next = "/app",
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  label: string;
  hint: string;
  errors: Record<string, string>;
  verifying: string;
  done: string;
  next?: string;
}) {
  // One real input (robust for fast typing, paste, OS/one-time-code autofill and password managers);
  // the six boxes only visualise its value.
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const digits = Array.from({ length: LEN }, (_, i) => value[i] ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(action, undefined);
  const [shake, setShake] = useState(0);
  const router = useRouter();
  const ok = state?.ok === true;
  const phase: "idle" | "checking" | "success" = ok ? "success" : pending ? "checking" : "idle";
  const active = Math.min(value.length, LEN - 1);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (state?.error) {
      setShake((n) => n + 1);
      setValue("");
      inputRef.current?.focus();
    }
    if (ok) {
      const t = setTimeout(() => router.push(state?.redirect ?? next), 1300);
      return () => clearTimeout(t);
    }
  }, [state, ok, router, next]);

  const onInput = (raw: string) => {
    const v = raw.replace(/D/g, "").slice(0, LEN);
    setValue(v);
    if (v.length === LEN) requestAnimationFrame(() => formRef.current?.requestSubmit());
  };
  const centre = (LEN - 1) / 2;

  return (
    <form ref={formRef} action={formAction} className="flex flex-col items-center">
      <input type="hidden" name="code" value={value} />
      <fieldset className="relative flex h-[72px] items-center justify-center" style={{ width: LEN * BOX + (LEN - 1) * GAP }}>
        <legend className="sr-only">{label}</legend>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={LEN}
          disabled={phase !== "idle"}
          aria-label={label}
          className="absolute inset-0 z-[2] size-full cursor-text opacity-0"
        />
        <motion.div key={shake} className="flex" style={{ gap: GAP }} animate={shake ? { x: [0, -10, 10, -7, 7, -3, 0] } : undefined} transition={{ duration: 0.45 }} aria-hidden>
          {digits.map((d, i) => (
            <motion.span
              key={i}
              className={`lq-box relative grid shrink-0 place-items-center rounded-[16px] border-2 bg-white/90 ${i === active && focused && phase === "idle" ? "border-takt shadow-[0_0_0_4px_rgba(29,91,216,0.18)]" : "border-white/70"}`}
              style={{ width: BOX, height: 60 }}
              animate={{
                x: phase === "success" ? (centre - i) * (BOX + GAP) : 0,
                rotate: phase === "checking" ? (i % 2 ? -7 : 7) : 0,
                scale: phase === "success" ? 0.35 : 1,
                opacity: phase === "success" ? 0 : 1,
                borderRadius: phase === "success" ? "50%" : "16px",
              }}
              transition={{ x: { type: "spring", stiffness: 380, damping: 32 }, rotate: { type: "spring", stiffness: 300, damping: 14 }, scale: { duration: 0.35, delay: 0.15 }, opacity: { duration: 0.2, delay: 0.3 } }}
            >
              <Water on={d !== ""} />
              {!d && !(i === active && focused) && <span className="absolute size-2 rounded-full bg-slate-300" aria-hidden />}
              <span className={`relative z-[1] font-display text-[1.6rem] font-extrabold tabular-nums ${d ? "text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.25)]" : ""}`}>{d}</span>
              {i === active && focused && !d && phase === "idle" && <span className="lq-caret absolute z-[1] h-6 w-[2px] rounded-full bg-takt" />}
            </motion.span>
          ))}
        </motion.div>

        {/* merged drop */}
        <AnimatePresence>
          {phase === "success" && (
            <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: [0, 1.18, 1], opacity: 1 }} transition={{ delay: 0.4, duration: 0.55, ease: [0.34, 1.56, 0.64, 1] }} className="absolute grid size-[76px] place-items-center rounded-full bg-gradient-to-b from-[#34d399] to-[#059669] shadow-[0_14px_30px_-10px_rgba(5,150,105,0.8)]" aria-hidden>
              <span className="lq-drop-wave" />
              <motion.svg viewBox="0 0 24 24" className="relative size-10" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }}>
                <motion.polyline points="20 6 9 17 4 12" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.75, duration: 0.4 }} />
              </motion.svg>
            </motion.span>
          )}
        </AnimatePresence>
      </fieldset>

      <p className="mt-5 min-h-[1.5rem] text-center text-sm" role="status" aria-live="polite">
        {ok ? <span className="font-semibold text-[#bbf7d0]">{done}</span> : pending ? <span className="text-white/80">{verifying}</span> : state?.error ? <span className="font-semibold text-[#fecaca]">{errors[state.error] ?? errors.invalid}</span> : <span className="text-white/70">{hint}</span>}
      </p>
    </form>
  );
}
