import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, schema } from "@sichttakt/db";
import { getConfig } from "@sichttakt/config";
import { appleClientSecret, beginSocialLogin, completeSocialLogin, createLoginChallenge, getSession, registerUser, resendLoginChallenge, resolveSocialUser, verifyLoginChallenge } from "@sichttakt/core";
import { createTestServices } from "./helpers";

let svc: Awaited<ReturnType<typeof createTestServices>>;
beforeAll(async () => {
  svc = await createTestServices();
});
afterAll(() => svc.close());

const config = getConfig({ NODE_ENV: "test", AUTH_GOOGLE_CLIENT_ID: "gid.apps.googleusercontent.com", AUTH_GOOGLE_CLIENT_SECRET: "gsecret" } as NodeJS.ProcessEnv);
const REDIRECT = "http://localhost:3610/auth/google/callback";
const jwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

/** Starts a flow and returns state + nonce as the provider would echo them back. */
async function start() {
  const url = new URL(await beginSocialLogin(svc.db, config, { provider: "google", redirectUri: REDIRECT, next: "/app/publish" }));
  expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  return { state: url.searchParams.get("state")!, nonce: url.searchParams.get("nonce")! };
}
const tokenEndpoint = (claims: Record<string, unknown>) => (async () => new Response(JSON.stringify({ id_token: jwt(claims) }), { status: 200 })) as unknown as typeof fetch;
const now = () => Math.floor(Date.now() / 1000);
const lastCode = () => /\b(\d{6})\b/.exec(svc.mailer.sent.at(-1)!.text)![1]!;

describe("sign in with Google + email code", () => {
  it("rejects unknown/replayed state, wrong audience, wrong nonce and unverified email", async () => {
    const { state, nonce } = await start();
    const good = { iss: "https://accounts.google.com", aud: "gid.apps.googleusercontent.com", exp: now() + 600, nonce, sub: "g-1", email: "Neu@Example.test", email_verified: true, name: "Neu Nutzer" };
    await expect(completeSocialLogin(svc.db, config, { provider: "google", state: "nope", code: "c", redirectUri: REDIRECT, fetchImpl: tokenEndpoint(good) })).rejects.toMatchObject({ message: "invalid_state" });

    const id = await completeSocialLogin(svc.db, config, { provider: "google", state, code: "c", redirectUri: REDIRECT, fetchImpl: tokenEndpoint(good) });
    expect(id).toMatchObject({ subject: "g-1", email: "neu@example.test", emailVerified: true, redirectAfter: "/app/publish" });
    // state is single use
    await expect(completeSocialLogin(svc.db, config, { provider: "google", state, code: "c", redirectUri: REDIRECT, fetchImpl: tokenEndpoint(good) })).rejects.toMatchObject({ message: "invalid_state" });

    const s2 = await start();
    await expect(completeSocialLogin(svc.db, config, { provider: "google", state: s2.state, code: "c", redirectUri: REDIRECT, fetchImpl: tokenEndpoint({ ...good, nonce: s2.nonce, aud: "someone-else" }) })).rejects.toMatchObject({ message: "invalid_audience" });
    const s3 = await start();
    await expect(completeSocialLogin(svc.db, config, { provider: "google", state: s3.state, code: "c", redirectUri: REDIRECT, fetchImpl: tokenEndpoint({ ...good, nonce: "forged" }) })).rejects.toMatchObject({ message: "invalid_nonce" });
    const s4 = await start();
    await expect(completeSocialLogin(svc.db, config, { provider: "google", state: s4.state, code: "c", redirectUri: REDIRECT, fetchImpl: tokenEndpoint({ ...good, nonce: s4.nonce, exp: now() - 10 }) })).rejects.toMatchObject({ message: "token_expired" });

    await expect(resolveSocialUser(svc.db, { provider: "google", subject: "g-x", email: "x@example.test", emailVerified: false, name: null })).rejects.toMatchObject({ message: "email_not_verified" });
  });

  it("creates the account, links existing accounts by verified email and reuses the identity", async () => {
    const a = await resolveSocialUser(svc.db, { provider: "google", subject: "g-new", email: "fresh@example.test", emailVerified: true, name: "Fresh" });
    expect(a.created).toBe(true);
    expect(a.user.passwordHash).toBeNull();
    const again = await resolveSocialUser(svc.db, { provider: "google", subject: "g-new", email: "changed@example.test", emailVerified: true, name: null });
    expect(again).toMatchObject({ created: false, user: { id: a.user.id } });

    const existing = await registerUser(svc.db, { email: "owner-pw@example.test", name: "Owner", password: "Sicher-Passwort-123" });
    const linked = await resolveSocialUser(svc.db, { provider: "apple", subject: "a-1", email: "OWNER-PW@example.test".toLowerCase(), emailVerified: true, name: null });
    expect(linked).toMatchObject({ created: false, user: { id: existing.id } });
  });

  it("only opens a session after the emailed code; wrong codes count and lock the challenge", async () => {
    const { user } = await resolveSocialUser(svc.db, { provider: "google", subject: "g-otp", email: "otp@example.test", emailVerified: true, name: "Otp" });
    const ch = await createLoginChallenge(svc.db, svc.mailer, { userId: user.id, email: user.email, locale: "de", provider: "google", redirectAfter: "/app" });
    expect(svc.mailer.sent.at(-1)!.to).toBe("otp@example.test");
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(verifyLoginChallenge(svc.db, ch.token, wrong)).rejects.toMatchObject({ message: "invalid_code" });
    const [row] = await svc.db.select().from(schema.loginChallenges).where(eq(schema.loginChallenges.userId, user.id));
    expect(row!.attempts).toBe(1);
    expect(row!.codeHash).not.toContain(code); // only a hash is stored

    const ok = await verifyLoginChallenge(svc.db, ch.token, code);
    expect(ok).toMatchObject({ twoFactorRequired: false, hasOrganization: false, redirectAfter: "/app" });
    expect(await getSession(svc.db, ok.sessionToken)).toBeTruthy();
    // single use
    await expect(verifyLoginChallenge(svc.db, ch.token, code)).rejects.toMatchObject({ message: "challenge_expired" });

    const ch2 = await createLoginChallenge(svc.db, svc.mailer, { userId: user.id, email: user.email, locale: "en", provider: "apple" });
    expect(svc.mailer.sent.at(-1)!.subject).toMatch(/sign-in code/);
    for (let i = 0; i < 4; i++) await expect(verifyLoginChallenge(svc.db, ch2.token, "999999" === lastCode() ? "888888" : "999999")).rejects.toMatchObject({ message: "invalid_code" });
    await expect(verifyLoginChallenge(svc.db, ch2.token, "999999" === lastCode() ? "888888" : "999999")).rejects.toMatchObject({ message: "too_many_attempts" });
    // locked: even the right code no longer works
    await expect(verifyLoginChallenge(svc.db, ch2.token, lastCode())).rejects.toMatchObject({ message: "challenge_expired" });
  });

  it("throttles resends", async () => {
    const { user } = await resolveSocialUser(svc.db, { provider: "google", subject: "g-resend", email: "resend@example.test", emailVerified: true, name: null });
    const ch = await createLoginChallenge(svc.db, svc.mailer, { userId: user.id, email: user.email, locale: "de", provider: "google" });
    await expect(resendLoginChallenge(svc.db, svc.mailer, ch.token, { provider: "google" })).rejects.toMatchObject({ message: "resend_too_soon" });
  });

  it("signs Apple's client secret as a verifiable ES256 JWT", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwtStr = appleClientSecret({ clientId: "de.bleibsichtbar.puffer.web", teamId: "TEAM123456", keyId: "KEY1234567", privateKey: pem });
    const [h, p, s] = jwtStr.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(JSON.parse(Buffer.from(p!, "base64url").toString())).toMatchObject({ iss: "TEAM123456", sub: "de.bleibsichtbar.puffer.web", aud: "https://appleid.apple.com" });
    expect(cryptoVerify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"))).toBe(true);
  });
});

describe("sign-up email code", () => {
  it("mails a verification code, marks the email verified on success, and only reveals the code when asked", async () => {
    const u = await registerUser(svc.db, { email: "signup-code@example.test", name: "Neu", password: "Sicher-Passwort-123" });
    expect(u.emailVerifiedAt).toBeNull();
    const ch = await createLoginChallenge(svc.db, svc.mailer, { userId: u.id, email: u.email, locale: "de", purpose: "signup", redirectAfter: "/onboarding" });
    expect(ch.devCode).toBeUndefined();
    expect(svc.mailer.sent.at(-1)!.subject).toMatch(/Bestätigungscode/);
    const ok = await verifyLoginChallenge(svc.db, ch.token, lastCode());
    expect(ok).toMatchObject({ purpose: "signup", hasOrganization: false, redirectAfter: "/onboarding" });
    const [row] = await svc.db.select().from(schema.users).where(eq(schema.users.id, u.id));
    expect(row!.emailVerifiedAt).toBeInstanceOf(Date);

    const dev = await createLoginChallenge(svc.db, svc.mailer, { userId: u.id, email: u.email, locale: "de", purpose: "verify_email", revealCode: true });
    expect(dev.devCode).toBe(lastCode());
  });
});
