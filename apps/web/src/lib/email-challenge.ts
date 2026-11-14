import "server-only";
import { cookies, headers } from "next/headers";
import { createLoginChallenge, type ChallengePurpose } from "@sichttakt/core";
import { services } from "@/lib/server";

// Server-only helpers for the email code step. Deliberately NOT in a "use server" file: exports there become
// client-callable actions, and starting a challenge for an arbitrary user must never be reachable from the browser.

export const CHALLENGE_COOKIE = "st_challenge";
export const DEV_CODE_COOKIE = "st_dev_code";
export const challengeCookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 15 * 60 };
/** Local development without SMTP only: the code is also shown on the page (labelled). Never in production. */
export const devReveal = () => process.env.NODE_ENV !== "production" && !services().config.SMTP_URL;
export const requestIp = async () => (await headers()).get("x-forwarded-for")?.split(",")[0] ?? undefined;

/** Starts the email code step for a user and sets the challenge cookie (caller redirects to /login/code). */
export async function startEmailChallenge(user: { id: string; email: string; locale: string }, purpose: ChallengePurpose, redirectAfter?: string | null) {
  const r = await createLoginChallenge(services().db, services().mailer, { userId: user.id, email: user.email, locale: user.locale, purpose, redirectAfter, ip: await requestIp(), revealCode: devReveal() });
  const jar = await cookies();
  jar.set(CHALLENGE_COOKIE, r.token, challengeCookieOpts);
  if (r.devCode) jar.set(DEV_CODE_COOKIE, r.devCode, challengeCookieOpts);
  else jar.delete(DEV_CODE_COOKIE);
}
