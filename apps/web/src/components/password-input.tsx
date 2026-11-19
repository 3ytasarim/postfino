"use client";
import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

/** Password field with a show/hide toggle (eye). The toggle is a real button with an accessible name and pressed state. */
export function PasswordInput({ showLabel = "Passwort anzeigen", hideLabel = "Passwort verbergen", className = "input", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { showLabel?: string; hideLabel?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={`${className} pr-12`} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        title={visible ? hideLabel : showLabel}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-[12px] text-ink-3 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--takt)]"
      >
        {visible ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
      </button>
    </div>
  );
}
