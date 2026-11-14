import { and, eq, isNull, schema, type Db } from "@sichttakt/db";
import { AppError, type ApiScope } from "@sichttakt/shared";
import { randomToken, sha256, safeEqual } from "./crypto";
import { authorize } from "./tenancy";
import { assertFeature, assertLimit } from "./entitlements";
import { audit } from "./audit";
import type { Actor } from "./rbac";

// Key format: st_<env>_<8-char id>_<secret>. Only sha256(secret) is stored; the full key is returned once.
// Keys are server-to-server credentials — the UI warns never to embed them in browsers or mobile apps.

const KEY_RE = /^st_(live|test)_([a-z0-9]{8})_([A-Za-z0-9_-]{32,})$/;

export async function createApiKey(
  db: Db,
  actor: Actor,
  p: { name: string; scopes: ApiScope[]; workspaceIds: string[]; environment?: "live" | "test"; expiresAt?: Date; rotatedFromId?: string },
) {
  authorize(actor, null, "apikeys.manage");
  await assertFeature(db, actor.organizationId, "public_api");
  await assertLimit(db, actor.organizationId, "apiKeys");
  // Workspaces must belong to the same organization (tenant isolation).
  const wss = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.organizationId, actor.organizationId));
  const own = new Set(wss.map((w) => w.id));
  if (p.workspaceIds.length === 0 || p.workspaceIds.some((w) => !own.has(w))) throw new AppError("WORKSPACE_NOT_ALLOWED", "Workspace not in this organization");
  if (p.expiresAt && p.expiresAt.getTime() <= Date.now()) throw new AppError("VALIDATION_FAILED", "expires_at must be in the future");

  const env = p.environment ?? "live";
  const shortId = randomToken(8).toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(8, "0").slice(0, 8);
  const secret = randomToken(32);
  const prefix = `st_${env}_${shortId}`;
  const [row] = await db
    .insert(schema.apiKeys)
    .values({
      organizationId: actor.organizationId,
      name: p.name,
      environment: env,
      prefix,
      secretHash: sha256(secret),
      scopes: p.scopes,
      workspaceIds: p.workspaceIds,
      createdByUserId: actor.kind === "user" ? actor.userId : null,
      expiresAt: p.expiresAt ?? null,
      rotatedFromId: p.rotatedFromId ?? null,
    })
    .returning();
  await audit(db, { organizationId: actor.organizationId, actor, action: "api_key.created", targetType: "api_key", targetId: row!.id, metadata: { prefix, scopes: p.scopes, env } });
  return { apiKey: publicKeyView(row!), secret: `${prefix}_${secret}` };
}

export async function verifyApiKey(db: Db, presented: string, now = new Date()): Promise<Extract<Actor, { kind: "api_key" }> & { perMinuteKey: string }> {
  const m = KEY_RE.exec(presented);
  if (!m) throw new AppError("INVALID_API_KEY", "Malformed API key");
  const prefix = `st_${m[1]}_${m[2]}`;
  const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.prefix, prefix));
  if (!row || !safeEqual(row.secretHash, sha256(m[3]!))) throw new AppError("INVALID_API_KEY", "Invalid API key");
  if (row.revokedAt) throw new AppError("API_KEY_REVOKED", "API key has been revoked");
  if (row.expiresAt && row.expiresAt <= now) throw new AppError("API_KEY_EXPIRED", "API key has expired");
  // Fire-and-forget usage timestamp (coarse: at most once a minute).
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000)
    await db.update(schema.apiKeys).set({ lastUsedAt: now }).where(eq(schema.apiKeys.id, row.id));
  return {
    kind: "api_key",
    apiKeyId: row.id,
    organizationId: row.organizationId,
    scopes: row.scopes as ApiScope[],
    workspaceIds: row.workspaceIds,
    environment: row.environment as "live" | "test",
    perMinuteKey: row.id,
  };
}

export async function revokeApiKey(db: Db, actor: Actor, keyId: string) {
  authorize(actor, null, "apikeys.manage");
  const [row] = await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, keyId), eq(schema.apiKeys.organizationId, actor.organizationId), isNull(schema.apiKeys.revokedAt)))
    .returning();
  if (!row) throw new AppError("NOT_FOUND", "API key not found");
  await audit(db, { organizationId: actor.organizationId, actor, action: "api_key.revoked", targetType: "api_key", targetId: keyId });
  return publicKeyView(row);
}

/** Rotation = new key with identical scopes, old key revoked immediately (no grace period in Phase 1). */
export async function rotateApiKey(db: Db, actor: Actor, keyId: string) {
  authorize(actor, null, "apikeys.manage");
  const [old] = await db.select().from(schema.apiKeys).where(and(eq(schema.apiKeys.id, keyId), eq(schema.apiKeys.organizationId, actor.organizationId)));
  if (!old || old.revokedAt) throw new AppError("NOT_FOUND", "API key not found");
  await revokeApiKey(db, actor, keyId);
  return createApiKey(db, actor, {
    name: old.name,
    scopes: old.scopes as ApiScope[],
    workspaceIds: old.workspaceIds,
    environment: old.environment as "live" | "test",
    expiresAt: old.expiresAt ?? undefined,
    rotatedFromId: old.id,
  });
}

export async function listApiKeys(db: Db, actor: Actor) {
  authorize(actor, null, "apikeys.manage");
  const rows = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.organizationId, actor.organizationId));
  return rows.map(publicKeyView);
}

export const publicKeyView = (r: typeof schema.apiKeys.$inferSelect) => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  environment: r.environment,
  scopes: r.scopes,
  workspaceIds: r.workspaceIds,
  expiresAt: r.expiresAt,
  revokedAt: r.revokedAt,
  lastUsedAt: r.lastUsedAt,
  createdAt: r.createdAt,
});
