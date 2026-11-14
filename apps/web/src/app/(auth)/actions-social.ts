"use server";
import { cookies, headers } from "next/headers";
import { isAppError, resendLoginChallenge, verifyLoginChallenge } from "@sichttakt/core";
import { services, SESSION_COOKIE } from "@/lib/server";
import { CHALLENGE_COOKIE, DEV_CODE_COOKIE, challengeCookieOpts, devReveal, requestIp } from "@/lib/email-challenge";
import type { FormState } from "./actions";

// Client-callable actions of the email code step. They only act on the challenge token the browser already holds.

export async function verifyLoginCodeAction(_: FormState, fd: FormData): Promise<FormState> {
  const jar = await cookies();
  const token = jar.get(CHALLENGE_COOKIE)?.value;
  if (!token) return { error: "expired" };
  try {
    const r = await verifyLoginChallenge(services().db, token, String(fd.get("code") ?? "").trim(), { ip: await requestIp(), userAgent: (await headers()).get("user-agent") ?? undefined });
    jar.set(SESSION_COOKIE, r.sessionToken, { ...challengeCookieOpts, maxAge: 14 * 86400 });
    jar.delete(CHALLENGE_COOKIE);
    jar.delete(DEV_CODE_COOKIE);
    const invite = r.redirectAfter?.startsWith("/invite/") ? r.redirectAfter : null;
    return { ok: true, redirect: r.twoFactorRequired ? "/login/2fa" : (invite ?? (!r.hasOrganization ? "/onboarding" : (r.redirectAfter ?? "/app"))) };
  } catch (e) {
    if (isAppError(e)) return { error: e.message === "too_many_attempts" ? "locked" : e.message === "challenge_expired" ? "expired" : "invalid" };
    throw e;
  }
}

export async function resendLoginCodeAction(_: FormState): Promise<FormState> {
  const jar = await cookies();
  const token = jar.get(CHALLENGE_COOKIE)?.value;
  if (!token) return { error: "expired" };
  try {
    const r = await resendLoginChallenge(services().db, services().mailer, token, { ip: await requestIp(), revealCode: devReveal() });
    if (r.devCode) jar.set(DEV_CODE_COOKIE, r.devCode, challengeCookieOpts);
    return { ok: true };
  } catch (e) {
    if (isAppError(e)) return { error: e.message === "resend_too_soon" ? "tooSoon" : "expired" };
    throw e;
  }
}
