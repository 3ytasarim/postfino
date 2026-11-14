import { and, eq, gt, isNull, sql, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import { decrypt, encrypt, hashPassword, randomToken, sha256, verifyPassword, type Keyring } from "./crypto";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";
import { audit } from "./audit";

// Session auth for the web app. Session token = random 32 bytes in an HttpOnly cookie; only sha256 stored.

export const SESSION_TTL_MS = 14 * 864e5;
const MAX_FAILED = 8;
const LOCK_MS = 15 * 60_000;

export function validatePasswordPolicy(pw: string): string | null {
  if (pw.length < 10) return "password_too_short";
  if (pw.length > 200) return "password_too_long";
  if (!/[A-Za-zÄÖÜäöüß]/.test(pw) || !/\d/.test(pw)) return "password_needs_letter_and_digit";
  return null;
}

export async function registerUser(db: Db, p: { email: string; name: string; password: string; locale?: string }) {
  const email = p.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("VALIDATION_FAILED", "invalid_email");
  const policy = validatePasswordPolicy(p.password);
  if (policy) throw new AppError("VALIDATION_FAILED", policy);
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`);
  if (existing) throw new AppError("CONFLICT", "email_taken");
  const [user] = await db
    .insert(schema.users)
    .values({ email, name: p.name.trim(), passwordHash: await hashPassword(p.password), locale: p.locale ?? "de" })
    .returning();
  await audit(db, { organizationId: null, actorType: "user", actorUserId: user!.id, action: "user.registered", targetType: "user", targetId: user!.id });
  return user!;
}

export async function login(db: Db, p: { email: string; password: string; ip?: string; userAgent?: string }) {
  const email = p.email.trim().toLowerCase();
  const [user] = await db.select().from(schema.users).where(and(sql`lower(${schema.users.email}) = ${email}`, isNull(schema.users.deletedAt)));
  // Same error for unknown email and wrong password (no user enumeration).
  const fail = new AppError("UNAUTHENTICATED", "invalid_credentials");
  if (!user || !user.passwordHash) {
    await hashPassword(p.password); // equalize timing
    throw fail;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new AppError("RATE_LIMITED", "account_locked", undefined, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000));
  if (!(await verifyPassword(p.password, user.passwordHash))) {
    const failed = user.failedLoginCount + 1;
    await db
      .update(schema.users)
      .set({ failedLoginCount: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MS) : null })
      .where(eq(schema.users.id, user.id));
    await audit(db, { organizationId: null, actorType: "user", actorUserId: user.id, action: "user.login_failed", ip: p.ip });
    throw fail;
  }
  await db.update(schema.users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(schema.users.id, user.id));
  const token = randomToken(32);
  const [membership] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id)).limit(1);
  await db.insert(schema.sessions).values({
    userId: user.id,
    tokenHash: sha256(token),
    activeOrganizationId: membership?.organizationId ?? null,
    twoFactorPending: Boolean(user.totpEnabledAt),
    ip: p.ip,
    userAgent: p.userAgent?.slice(0, 300),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  await audit(db, { organizationId: membership?.organizationId ?? null, actorType: "user", actorUserId: user.id, action: "user.login", ip: p.ip });
  return { token, user, twoFactorRequired: Boolean(user.totpEnabledAt) };
}

export async function getSession(db: Db, token: string | undefined) {
  if (!token) return null;
  const [row] = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date()), isNull(schema.users.deletedAt)));
  return row ?? null;
}

export async function setActiveContext(db: Db, token: string, p: { organizationId?: string; workspaceId?: string | null }) {
  await db
    .update(schema.sessions)
    .set({ activeOrganizationId: p.organizationId, activeWorkspaceId: p.workspaceId ?? null, lastSeenAt: new Date() })
    .where(eq(schema.sessions.tokenHash, sha256(token)));
}

export async function logout(db: Db, token: string) {
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.tokenHash, sha256(token)));
}

export async function revokeAllSessions(db: Db, userId: string) {
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
}

// ── 2FA ──
export async function beginTotpSetup(db: Db, ring: Keyring, userId: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) throw new AppError("NOT_FOUND", "user");
  const secret = generateTotpSecret();
  await db.update(schema.users).set({ totpSecretEnc: encrypt(ring, secret).value, totpEnabledAt: null }).where(eq(schema.users.id, userId));
  return { secret, uri: otpauthUri(secret, user.email) };
}

export async function confirmTotp(db: Db, ring: Keyring, userId: string, code: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.totpSecretEnc || !verifyTotp(decrypt(ring, user.totpSecretEnc), code)) throw new AppError("VALIDATION_FAILED", "invalid_totp");
  await db.update(schema.users).set({ totpEnabledAt: new Date() }).where(eq(schema.users.id, userId));
  await audit(db, { organizationId: null, actorType: "user", actorUserId: userId, action: "user.2fa_enabled" });
}

export async function completeTwoFactor(db: Db, ring: Keyring, token: string, code: string) {
  const s = await getSession(db, token);
  if (!s || !s.session.twoFactorPending || !s.user.totpSecretEnc) throw new AppError("UNAUTHENTICATED", "no_pending_2fa");
  if (!verifyTotp(decrypt(ring, s.user.totpSecretEnc), code)) throw new AppError("UNAUTHENTICATED", "invalid_totp");
  await db.update(schema.sessions).set({ twoFactorPending: false }).where(eq(schema.sessions.id, s.session.id));
}

// ── Password reset (email delivery pending SMTP; token returned to caller for dev/logging) ──
export async function createPasswordReset(db: Db, email: string) {
  const [user] = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email.trim().toLowerCase()}`);
  if (!user) return null; // caller responds identically either way
  const token = randomToken(32);
  await db.insert(schema.passwordResetTokens).values({ userId: user.id, purpose: "password_reset", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) });
  return { token, userId: user.id, locale: user.locale, email: user.email };
}

export async function resetPassword(db: Db, token: string, newPassword: string) {
  const policy = validatePasswordPolicy(newPassword);
  if (policy) throw new AppError("VALIDATION_FAILED", policy);
  const [row] = await db
    .select()
    .from(schema.passwordResetTokens)
    .where(and(eq(schema.passwordResetTokens.tokenHash, sha256(token)), eq(schema.passwordResetTokens.purpose, "password_reset"), isNull(schema.passwordResetTokens.usedAt), gt(schema.passwordResetTokens.expiresAt, new Date())));
  if (!row) throw new AppError("VALIDATION_FAILED", "invalid_or_expired_token");
  await db.update(schema.users).set({ failedLoginCount: 0, lockedUntil: null, passwordHash: await hashPassword(newPassword) }).where(eq(schema.users.id, row.userId));
  await db.update(schema.passwordResetTokens).set({ usedAt: new Date() }).where(eq(schema.passwordResetTokens.id, row.id));
  await revokeAllSessions(db, row.userId);
}

// ── Email verification ──
export async function createEmailVerification(db: Db, userId: string) {
  const token = randomToken(32);
  await db.insert(schema.passwordResetTokens).values({ userId, purpose: "email_verify", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 864e5) });
  return token;
}

export async function verifyEmail(db: Db, token: string) {
  const [row] = await db
    .select()
    .from(schema.passwordResetTokens)
    .where(and(eq(schema.passwordResetTokens.tokenHash, sha256(token)), eq(schema.passwordResetTokens.purpose, "email_verify"), isNull(schema.passwordResetTokens.usedAt), gt(schema.passwordResetTokens.expiresAt, new Date())));
  if (!row) throw new AppError("VALIDATION_FAILED", "invalid_or_expired_token");
  await db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, row.userId));
  await db.update(schema.passwordResetTokens).set({ usedAt: new Date() }).where(eq(schema.passwordResetTokens.id, row.id));
  await audit(db, { organizationId: null, actorType: "user", actorUserId: row.userId, action: "user.email_verified" });
  return row.userId;
}
