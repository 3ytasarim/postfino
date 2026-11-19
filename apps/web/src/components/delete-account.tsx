"use client";
import { useActionState } from "react";
import { deleteAccountAction } from "@/app/app/actions-account";
import type { Messages } from "@/i18n/de";

type Org = { id: string; name: string };
type Plan = { deleteOrganizations: Org[]; leaveOrganizations: Org[]; blockedByOwnership: Org[]; blockedBySubscription: Org[] };

const ERRORS: Record<string, keyof Messages["accountDelete"]> = {
  confirmation_failed: "errConfirm",
  owner_has_members: "errOwner",
  active_subscription: "errSub",
  super_admin: "errAdmin",
  check: "errCheck",
};

export function DeleteAccount({ t, plan, hasPassword }: { t: Messages["accountDelete"]; plan: Plan; hasPassword: boolean }) {
  const [state, action, pending] = useActionState(deleteAccountAction, undefined);
  const blocked = plan.blockedByOwnership.length > 0 || plan.blockedBySubscription.length > 0;
  const list = (title: string, orgs: Org[], tone = "text-ink-2") =>
    orgs.length > 0 && (
      <div className={`text-sm ${tone}`}>
        <p className="font-semibold">{title}</p>
        <ul className="mt-1 list-disc pl-5">
          {orgs.map((o) => (
            <li key={o.id}>{o.name}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-ink-2">{t.intro}</p>
      {list(t.willDelete, plan.deleteOrganizations)}
      {list(t.willLeave, plan.leaveOrganizations)}
      {list(t.blockedOwner, plan.blockedByOwnership, "text-bad")}
      {list(t.blockedSub, plan.blockedBySubscription, "text-bad")}
      {!blocked && (
        <>
          <div>
            <label className="label" htmlFor="del-confirm-input">
              {hasPassword ? t.password : t.email}
            </label>
            <input id="del-confirm-input" name={hasPassword ? "password" : "email"} type={hasPassword ? "password" : "email"} autoComplete={hasPassword ? "current-password" : "email"} required className="input max-w-sm" />
          </div>
          <label className="flex items-start gap-2 text-sm text-ink-2">
            <input type="checkbox" name="confirm" required className="mt-0.5 size-4 accent-[var(--bad)]" />
            {t.check}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn bg-bad text-white hover:opacity-90" disabled={pending}>
              {pending ? "…" : t.submit}
            </button>
            {state?.error && (
              <span role="alert" className="text-sm font-medium text-bad">
                {t[ERRORS[state.error] ?? "errConfirm"]}
              </span>
            )}
          </div>
        </>
      )}
    </form>
  );
}
