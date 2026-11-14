"use client";
import { useActionState, useEffect, useRef } from "react";
import type { ActionResult } from "@/app/app/actions";

/** Generic server-action form with inline error / success state. */
export function FormAction({
  action,
  children,
  submit,
  className,
  resetOnSuccess,
  submitClassName = "btn btn-primary",
}: {
  action: (s: ActionResult, fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submit: string;
  className?: string;
  resetOnSuccess?: boolean;
  submitClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className={submitClassName} disabled={pending}>
          {pending ? "…" : submit}
        </button>
        {state?.ok && <span className="text-sm font-medium text-ok">✓</span>}
        {state?.error && (
          <span role="alert" className="text-sm font-medium text-bad">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
