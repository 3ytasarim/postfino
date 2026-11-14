"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { login, registerUser, createOrganization, completeTwoFactor, logout, isAppError, setActiveContext, createPasswordReset, resetPassword, createEmailVerification, acceptInvite, mailTemplates } from "@sichttakt/core";
import { isValidTimeZone } from "@sichttakt/shared";
import { services, SESSION_COOKIE, currentSession } from "@/lib/server";
import { startEmailChallenge } from "@/lib/email-challenge";

export type FormState = { error?: string; ok?: boolean; redirect?: string } | undefined;

async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 14 * 86400 });
}

/** Only same-site relative paths (no open redirect). */
const safeNext = (p: string) => (/^\/(?!\/)[\w\-/?=&%.]*$/.test(p) ? p : "/app");

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const h = await headers();
  let nextPath = "/app";
  let needsCode = false;
  try {
    const r = await login(services().db, { email: String(fd.get("email") ?? ""), password: String(fd.get("password") ?? ""), ip: h.get("x-forwarded-for")?.split(",")[0] ?? undefined, userAgent: h.get("user-agent") ?? undefined });
    if (!r.user.emailVerifiedAt) {
      await logout(services().db, r.token); // no session until the mailbox is proven
      await startEmailChallenge(r.user, "verify_email", safeNext(String(fd.get("next") ?? "")));
      needsCode = true;
    } else await setSessionCookie(r.token);
    if (!needsCode && r.twoFactorRequired) redirect("/login/2fa");
    nextPath = safeNext(String(fd.get("next") ?? ""));
  } catch (e) {
    if (isAppError(e)) return { error: e.message === "account_locked" ? "locked" : "invalid" };
    throw e;
  }
  redirect(needsCode ? "/login/code" : nextPath);
}

export async function twoFactorAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await currentSession();
  if (!s) redirect("/login");
  try {
    await completeTwoFactor(services().db, services().ring, s.token, String(fd.get("code") ?? "").trim());
  } catch (e) {
    if (isAppError(e)) return { error: "invalid" };
    throw e;
  }
  return { ok: true }; // the OTP component shows the tick, then navigates to /app
}

export async function registerAction(_: FormState, fd: FormData): Promise<FormState> {
  const db = services().db;
  const email = String(fd.get("email") ?? "");
  const password = String(fd.get("password") ?? "");
  try {
    const user = await registerUser(db, { email, name: String(fd.get("name") ?? ""), password });
    const invite = String(fd.get("invite") ?? "");
    await startEmailChallenge(user, "signup", invite ? `/invite/${encodeURIComponent(invite)}` : "/onboarding");
  } catch (e) {
    if (isAppError(e)) return { error: e.message === "email_taken" ? "emailTaken" : e.message.startsWith("password") ? "passwordPolicy" : "invalid" };
    throw e;
  }
  redirect("/login/code");
}

export async function onboardingAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await currentSession();
  if (!s) redirect("/login");
  const tz = String(fd.get("timezone") ?? "Europe/Berlin");
  const org = String(fd.get("org") ?? "").trim();
  const ws = String(fd.get("workspace") ?? "").trim();
  if (org.length < 2 || ws.length < 2 || !isValidTimeZone(tz)) return { error: "invalid" };
  const { organization, workspace } = await createOrganization(services().db, { ownerUserId: s.user.id, name: org, workspaceName: ws, timezone: tz, locale: s.user.locale });
  await setActiveContext(services().db, s.token, { organizationId: organization.id, workspaceId: workspace.id });
  redirect("/app");
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await logout(services().db, token);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function forgotAction(_: FormState, fd: FormData): Promise<FormState> {
  const r = await createPasswordReset(services().db, String(fd.get("email") ?? ""));
  if (r) await services().mailer.send({ to: r.email, ...mailTemplates.reset(r.locale, `${services().config.APP_URL}/reset/${r.token}`) });
  // Same answer whether or not the account exists (no user enumeration).
  return { ok: true };
}

export async function resetAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    await resetPassword(services().db, String(fd.get("token") ?? ""), String(fd.get("password") ?? ""));
  } catch (e) {
    if (isAppError(e)) return { error: e.message.startsWith("password") ? "passwordPolicy" : "tokenInvalid" };
    throw e;
  }
  return { ok: true };
}

export async function acceptInviteAction(fd: FormData) {
  const s = await currentSession();
  if (!s) redirect("/login");
  const inv = await acceptInvite(services().db, String(fd.get("token") ?? ""), s.user);
  await setActiveContext(services().db, s.token, { organizationId: inv.organizationId, workspaceId: null });
  redirect("/app");
}
