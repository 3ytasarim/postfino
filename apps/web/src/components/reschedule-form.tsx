"use client";
import { useActionState } from "react";
import { rescheduleFormAction } from "@/app/app/actions";

/** Keyboard-accessible alternative to calendar drag & drop. */
export function RescheduleForm({ postId, defaultWhen, label, dstGap }: { postId: string; defaultWhen: string; label: string; dstGap: string }) {
  const [state, action, pending] = useActionState(rescheduleFormAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="postId" value={postId} />
      <label className="text-xs font-semibold text-ink-2">
        {label}
        <input name="when" type="datetime-local" defaultValue={defaultWhen} required className="input !min-h-[44px] mt-1" />
      </label>
      <button className="btn btn-ghost" disabled={pending}>
        {label}
      </button>
      {state?.error && <p className="w-full text-sm font-medium text-bad">{state.error === "dstGap" ? dstGap : state.error}</p>}
      {state?.ok && <p className="w-full text-sm font-medium text-ok">✓</p>}
    </form>
  );
}
