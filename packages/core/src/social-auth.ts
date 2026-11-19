import { createPrivateKey, randomInt, sign as cryptoSign, createHash } from "node:crypto";
import { and, eq, gt, isNull, sql, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import type { AppConfig } from "@sichttakt/config";
import { randomToken, sha256, safeEqual } from "./crypto";
import { audit } from "./audit";
import { SESSION_TTL_MS } from "./auth";
import { mailTemplates, type Mailer } from "./mailer";

// "Sign in with Google / Apple" (OpenID Connect, authorization code + PKCE + nonce), followed by an email one-time
// code before any session exists. Flow:
//   start  → state/nonce/verifier stored (hashed state, 10 min) → redirect to provider
//   callback → state consumed once → code exchanged server-side over TLS → id_token claims checked
//              (iss, aud, exp, nonce, verified email) → user found/linked/created → login challenge mailed
//   /login/code → 6-digit code (10 min, 5 attempts, resend throttled) → session (2FA still applies)
// The id_token comes straight from the provider's token endpoint over TLS, which OIDC Core §3.1.3.7 accepts in place
// of a signature check; every claim that matters is still validated.

export type SocialProvider = "google" | "apple";
type Fetch = typeof fetch;

const STATE_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const RESEND_AFTER_MS = 45_000;
const MAX_SENDS = 5;

const GOOGLE = { auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", issuers: ["https://accounts.google.com", "accounts.google.com"] };
const APPLE = { auth: "https://appleid.apple.com/auth/authorize", token: "https://appleid.apple.com/auth/token", issuers: ["https://appleid.apple.com"] };

export function socialProviderConfig(config: AppConfig) {
  const googleId = config.AUTH_GOOGLE_CLIENT_ID ?? config.GOOGLE_CLIENT_ID;
  const googleSecret = config.AUTH_GOOGLE_CLIENT_SECRET ?? config.GOOGLE_CLIENT_SECRET;
  return {
    google: googleId && googleSecret ? { clientId: googleId, clientSecret: googleSecret } : null,
    apple: config.APPLE_CLIENT_ID && config.APPLE_TEAM_ID && config.APPLE_KEY_ID && config.APPLE_PRIVATE_KEY ? { clientId: config.APPLE_CLIENT_ID, teamId: config.APPLE_TEAM_ID, keyId: config.APPLE_KEY_ID, privateKey: config.APPLE_PRIVATE_KEY.replace(/\\n/g, "\n") } : null,
  };
}
export const isSocialConfigured = (config: AppConfig, p: SocialProvider) => Boolean(socialProviderConfig(config)[p]);

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const safeNext = (n: string | undefined | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : null);

/** Apple's client_secret: a short-lived ES256 JWT signed with the Sign-in-with-Apple key. */
export function appleClientSecret(a: { clientId: string; teamId: string; keyId: string; privateKey: string }, now = Date.now()) {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: a.keyId }));
  const iat = Math.floor(now / 1000);
  const payload = b64url(JSON.stringify({ iss: a.teamId, iat, exp: iat + 300, aud: "https://appleid.apple.com", sub: a.clientId }));
  const sig = cryptoSign("sha256", Buffer.from(`${header}.${payload}`), { key: createPrivateKey(a.privateKey), dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64url(sig)}`;
}

export async function beginSocialLogin(db: Db, config: AppConfig, p: { provider: SocialProvider; redirectUri: string; next?: string }) {
  const prov = socialProviderConfig(config)[p.provider];
  if (!prov) throw new AppError("PROVIDER_NOT_CONFIGURED", `${p.provider}_login_not_configured`);
  const state = randomToken(32);
  const nonce = randomToken(24);
  const verifier = randomToken(48);
  await db.insert(schema.socialLoginStates).values({ stateHash: sha256(state), provider: p.provider, nonce, codeVerifier: verifier, redirectAfter: safeNext(p.next), expiresAt: new Date(Date.now() + STATE_TTL_MS) });
  const u = new URL(p.provider === "google" ? GOOGLE.auth : APPLE.auth);
  u.searchParams.set("client_id", prov.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("code_challenge", pkceChallenge(verifier));
  u.searchParams.set("code_challenge_method", "S256");
  if (p.provider === "google") {
    u.searchParams.set("scope", "openid email profile");
    u.searchParams.set("prompt", "select_account");
  } else {
    u.searchParams.set("scope", "name email");
    u.searchParams.set("response_mode", "form_post"); // required by Apple when scopes are requested
  }
  return u.toString();
}

type Claims = { iss?: string; aud?: string | string[]; exp?: number; nonce?: string; sub?: string; email?: string; email_verified?: boolean | string; name?: string; is_private_email?: boolean | string };

function decodeIdToken(idToken: string): Claims {
  const part = idToken.split(".")[1];
  if (!part) throw new AppError("UNAUTHENTICATED", "invalid_id_token");
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Claims;
  } catch {
    throw new AppError("UNAUTHENTICATED", "invalid_id_token");
  }
}

/** Completes the provider round trip and returns the verified identity (no session yet). */
export async function completeSocialLogin(
  db: Db,
  config: AppConfig,
  p: { provider: SocialProvider; state: string; code: string; redirectUri: string; appleUser?: string; fetchImpl?: Fetch; now?: Date },
) {
  const now = p.now ?? new Date();
  const prov = socialProviderConfig(config)[p.provider];
  if (!prov) throw new AppError("PROVIDER_NOT_CONFIGURED", `${p.provider}_login_not_configured`);
  // state is single use: delete-returning makes a replay find nothing
  const [st] = await db
    .delete(schema.socialLoginStates)
    .where(and(eq(schema.socialLoginStates.stateHash, sha256(p.state)), eq(schema.socialLoginStates.provider, p.provider), gt(schema.socialLoginStates.expiresAt, now)))
    .returning();
  if (!st) throw new AppError("UNAUTHENTICATED", "invalid_state");

  const body = new URLSearchParams({ grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, client_id: prov.clientId, code_verifier: st.codeVerifier });
  body.set("client_secret", p.provider === "google" ? (prov as { clientSecret: string }).clientSecret : appleClientSecret(prov as Parameters<typeof appleClientSecret>[0], now.getTime()));
  const res = await (p.fetchImpl ?? fetch)(p.provider === "google" ? GOOGLE.token : APPLE.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
  const tok = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !tok.id_token) throw new AppError("UNAUTHENTICATED", `token_exchange_failed${tok.error ? `:${tok.error}` : ""}`);

  const c = decodeIdToken(tok.id_token);
  const issuers = p.provider === "google" ? GOOGLE.issuers : APPLE.issuers;
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!c.iss || !issuers.includes(c.iss)) throw new AppError("UNAUTHENTICATED", "invalid_issuer");
  if (!aud.includes(prov.clientId)) throw new AppError("UNAUTHENTICATED", "invalid_audience");
  if (!c.exp || c.exp * 1000 < now.getTime()) throw new AppError("UNAUTHENTICATED", "token_expired");
  if (!c.nonce || !safeEqual(c.nonce, st.nonce)) throw new AppError("UNAUTHENTICATED", "invalid_nonce");
  if (!c.sub) throw new AppError("UNAUTHENTICATED", "missing_subject");
  const emailVerified = c.email_verified === true || c.email_verified === "true";

  let name = c.name;
  if (!name && p.appleUser) {
    // Apple sends the name only on the very first authorisation, as JSON in the form post
    try {
      const u = JSON.parse(p.appleUser) as { name?: { firstName?: string; lastName?: string } };
      name = [u.name?.firstName, u.name?.lastName].filter(Boolean).join(" ") || undefined;
    } catch {
      /* ignore malformed */
    }
  }
  return { provider: p.provider, subject: c.sub, email: c.email?.trim().toLowerCase() ?? null, emailVerified, name: name ?? null, redirectAfter: st.redirectAfter };
}

/**
 * Finds the user for a provider identity: known identity → that user; otherwise a verified email links to an existing
 * account; otherwise a new account is created (no password). Unverified emails never link to existing accounts.
 */
export async function resolveSocialUser(db: Db, id: { provider: SocialProvider; subject: string; email: string | null; emailVerified: boolean; name: string | null }, opts: { locale?: string } = {}) {
  const [known] = await db.select({ userId: schema.userIdentities.userId }).from(schema.userIdentities).where(and(eq(schema.userIdentities.provider, id.provider), eq(schema.userIdentities.subject, id.subject)));
  if (known) {
    await db.update(schema.userIdentities).set({ lastUsedAt: new Date() }).where(and(eq(schema.userIdentities.provider, id.provider), eq(schema.userIdentities.subject, id.subject)));
    const [u] = await db.select().from(schema.users).where(and(eq(schema.users.id, known.userId), isNull(schema.users.deletedAt)));
    if (!u) throw new AppError("UNAUTHENTICATED", "account_deleted");
    return { user: u, created: false };
  }
  if (!id.email || !id.emailVerified) throw new AppError("UNAUTHENTICATED", "email_not_verified");
  const [existing] = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${id.email}`);
  if (existing?.deletedAt) throw new AppError("UNAUTHENTICATED", "account_deleted");
  const user =
    existing ??
    (
      await db
        .insert(schema.users)
        .values({ email: id.email, name: (id.name ?? id.email.split("@")[0] ?? "").slice(0, 120), passwordHash: null, emailVerifiedAt: new Date(), locale: opts.locale ?? "de" })
        .returning()
    )[0]!;
  await db.insert(schema.userIdentities).values({ userId: user.id, provider: id.provider, subject: id.subject, email: id.email, lastUsedAt: new Date() }).onConflictDoNothing();
  await audit(db, { organizationId: null, actorType: "user", actorUserId: user.id, action: existing ? "user.identity_linked" : "user.registered_social", metadata: { provider: id.provider } });
  return { user, created: !existing };
}

const codeHash = (challengeId: string, code: string) => sha256(`${challengeId}:${code}`);
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Creates the email step: returns the browser token (cookie) — the code itself only goes out by email. */
export type ChallengePurpose = "signup" | "verify_email" | "social_login";
const challengeMail = (purpose: string, locale: string, code: string, provider: string) => (purpose === "social_login" ? mailTemplates.loginCode(locale, code, provider === "apple" ? "Apple" : "Google") : mailTemplates.signupCode(locale, code));

/**
 * Creates an email code step (sign-up, unverified sign-in, social sign-in). Returns the browser token (cookie);
 * the code itself only goes out by email — `revealCode` exists for local development without SMTP and must never be
 * set in production.
 */
export async function createLoginChallenge(db: Db, mailer: Mailer, p: { userId: string; email: string; locale: string; provider?: string; purpose?: ChallengePurpose; redirectAfter?: string | null; ip?: string; revealCode?: boolean }) {
  const purpose = p.purpose ?? "social_login";
  const token = randomToken(32);
  const code = newCode();
  const [ch] = await db
    .insert(schema.loginChallenges)
    .values({ userId: p.userId, tokenHash: sha256(token), codeHash: "pending", purpose, redirectAfter: safeNext(p.redirectAfter), expiresAt: new Date(Date.now() + CODE_TTL_MS) })
    .returning();
  await db.update(schema.loginChallenges).set({ codeHash: codeHash(ch!.id, code) }).where(eq(schema.loginChallenges.id, ch!.id));
  const sent = await mailer.send({ to: p.email, ...challengeMail(purpose, p.locale, code, p.provider ?? "") });
  await audit(db, { organizationId: null, actorType: "user", actorUserId: p.userId, action: "user.email_code_sent", ip: p.ip, metadata: { purpose, provider: p.provider, delivered: sent.delivered } });
  return { token, delivered: sent.delivered, expiresAt: ch!.expiresAt, devCode: p.revealCode ? code : undefined };
}

async function activeChallenge(db: Db, token: string) {
  const [row] = await db
    .select({ ch: schema.loginChallenges, user: schema.users })
    .from(schema.loginChallenges)
    .innerJoin(schema.users, eq(schema.users.id, schema.loginChallenges.userId))
    .where(and(eq(schema.loginChallenges.tokenHash, sha256(token)), isNull(schema.loginChallenges.consumedAt), gt(schema.loginChallenges.expiresAt, new Date()), isNull(schema.users.deletedAt)));
  return row ?? null;
}

/** For the code page: which address the code went to (shown in full – the person just typed it; a masked
 *  "sy•@…" read like a typo for short addresses), and when a resend is possible. */
export async function describeLoginChallenge(db: Db, token: string | undefined) {
  if (!token) return null;
  const row = await activeChallenge(db, token);
  if (!row) return null;
  return { email: row.user.email, resendAt: new Date(row.ch.lastSentAt.getTime() + RESEND_AFTER_MS), expiresAt: row.ch.expiresAt };
}

export async function resendLoginChallenge(db: Db, mailer: Mailer, token: string, p: { provider?: string; ip?: string; revealCode?: boolean }) {
  const row = await activeChallenge(db, token);
  if (!row) throw new AppError("UNAUTHENTICATED", "challenge_expired");
  if (Date.now() - row.ch.lastSentAt.getTime() < RESEND_AFTER_MS || row.ch.sends >= MAX_SENDS) throw new AppError("RATE_LIMITED", "resend_too_soon");
  const code = newCode();
  await db
    .update(schema.loginChallenges)
    .set({ codeHash: codeHash(row.ch.id, code), sends: row.ch.sends + 1, attempts: 0, lastSentAt: new Date(), expiresAt: new Date(Date.now() + CODE_TTL_MS) })
    .where(eq(schema.loginChallenges.id, row.ch.id));
  await mailer.send({ to: row.user.email, ...challengeMail(row.ch.purpose, row.user.locale, code, p.provider ?? "") });
  await audit(db, { organizationId: null, actorType: "user", actorUserId: row.user.id, action: "user.email_code_resent", ip: p.ip });
  return { devCode: p.revealCode ? code : undefined };
}

/** Verifies the code; on success the challenge is consumed and a session is created (2FA still pending if enabled). */
export async function verifyLoginChallenge(db: Db, token: string, code: string, p: { ip?: string; userAgent?: string } = {}) {
  const row = await activeChallenge(db, token);
  if (!row) throw new AppError("UNAUTHENTICATED", "challenge_expired");
  if (row.ch.attempts >= MAX_ATTEMPTS) throw new AppError("RATE_LIMITED", "too_many_attempts");
  const ok = /^\d{6}$/.test(code) && safeEqual(codeHash(row.ch.id, code), row.ch.codeHash);
  if (!ok) {
    const attempts = row.ch.attempts + 1;
    await db.update(schema.loginChallenges).set({ attempts, ...(attempts >= MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) }).where(eq(schema.loginChallenges.id, row.ch.id));
    await audit(db, { organizationId: null, actorType: "user", actorUserId: row.user.id, action: "user.login_code_failed", ip: p.ip });
    throw new AppError(attempts >= MAX_ATTEMPTS ? "RATE_LIMITED" : "UNAUTHENTICATED", attempts >= MAX_ATTEMPTS ? "too_many_attempts" : "invalid_code");
  }
  // consume first (single use even under concurrent submits)
  const [consumed] = await db.update(schema.loginChallenges).set({ consumedAt: new Date() }).where(and(eq(schema.loginChallenges.id, row.ch.id), isNull(schema.loginChallenges.consumedAt))).returning();
  if (!consumed) throw new AppError("UNAUTHENTICATED", "challenge_expired");
  // holding the code proves control of the mailbox
  if (!row.user.emailVerifiedAt) await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, row.user.id));
  const user = row.user;
  const sessionToken = randomToken(32);
  const [membership] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id)).limit(1);
  await db.insert(schema.sessions).values({
    userId: user.id,
    tokenHash: sha256(sessionToken),
    activeOrganizationId: membership?.organizationId ?? null,
    twoFactorPending: Boolean(user.totpEnabledAt),
    ip: p.ip,
    userAgent: p.userAgent?.slice(0, 300),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  await audit(db, { organizationId: membership?.organizationId ?? null, actorType: "user", actorUserId: user.id, action: "user.login", ip: p.ip, metadata: { method: `email_code:${row.ch.purpose}` } });
  return { sessionToken, twoFactorRequired: Boolean(user.totpEnabledAt), hasOrganization: Boolean(membership), redirectAfter: row.ch.redirectAfter, purpose: row.ch.purpose };
}
