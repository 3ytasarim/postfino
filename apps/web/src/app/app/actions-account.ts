"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { deleteOwnAccount, isAppError, mailTemplates } from "@sichttakt/core";
import { currentSession, services, SESSION_COOKIE } from "@/lib/server";
import type { ActionResult } from "./actions";

/** Settings → "Konto löschen". Re-confirms with password (or email for social sign-in accounts); see core/account-deletion. */
export async function deleteAccountAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (fd.get("confirm") !== "on") return { error: "check" };
  const svc = services();
  let result: Awaited<ReturnType<typeof deleteOwnAccount>>;
  try {
    result = await deleteOwnAccount(svc, s.user.id, { password: String(fd.get("password") ?? "") || undefined, email: String(fd.get("email") ?? "") || undefined });
  } catch (e) {
    if (isAppError(e)) return { error: e.message };
    throw e;
  }
  (await cookies()).delete(SESSION_COOKIE);
  await svc.mailer.send({ to: result.email, ...mailTemplates.accountDeleted(result.locale) }).catch(() => undefined);
  redirect("/login?deleted=1");
}
