"use client";
import { useActionState } from "react";
import type { FormState } from "@/app/(auth)/actions";
import { PasswordInput } from "./password-input";

type Field = { name: string; label: string; type?: string; autoComplete?: string; hint?: string; defaultValue?: string; options?: string[] };

export function AuthForm({
  action,
  fields,
  submit,
  errors,
  success,
  hidden = {},
  passwordToggle,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  fields: Field[];
  submit: string;
  errors: Record<string, string>;
  success?: string;
  hidden?: Record<string, string>;
  passwordToggle?: { show: string; hide: string };
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-4">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {fields.map((f) => (
        <div key={f.name}>
          <label className="label" htmlFor={f.name}>
            {f.label}
          </label>
          {f.options ? (
            <select id={f.name} name={f.name} className="input" defaultValue={f.defaultValue}>
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : f.type === "password" ? (
            <PasswordInput
              id={f.name}
              name={f.name}
              autoComplete={f.autoComplete}
              required
              aria-describedby={f.hint ? `${f.name}-hint` : undefined}
              showLabel={passwordToggle?.show}
              hideLabel={passwordToggle?.hide}
            />
          ) : (
            <input
              id={f.name}
              name={f.name}
              type={f.type ?? "text"}
              autoComplete={f.autoComplete}
              defaultValue={f.defaultValue}
              required
              className="input"
              aria-describedby={f.hint ? `${f.name}-hint` : undefined}
            />
          )}
          {f.hint && (
            <p id={`${f.name}-hint`} className="mt-1.5 text-xs text-ink-3">
              {f.hint}
            </p>
          )}
        </div>
      ))}
      {state?.error && (
        <p role="alert" className="rounded-[12px] bg-bad-soft px-3 py-2.5 text-sm font-medium text-bad">
          {errors[state.error] ?? errors.invalid}
        </p>
      )}
      {state?.ok && success && (
        <p role="status" className="rounded-[12px] bg-ok-soft px-3 py-2.5 text-sm font-medium text-ok">
          {success}
        </p>
      )}
      <button className="btn btn-primary w-full" disabled={pending}>
        {pending ? "…" : submit}
      </button>
    </form>
  );
}
