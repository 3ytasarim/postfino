import { and, eq, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import { sha256 } from "./crypto";
import { stableStringify } from "./util";

// Idempotency-Key handling for public API write endpoints (24h retention).
// - same key + same request → stored response replayed (no second post)
// - same key + different request → 422 IDEMPOTENCY_KEY_REUSED
// - concurrent duplicate while first is in flight → 409 CONFLICT (client retries)

const TTL_MS = 24 * 3600_000;

export async function withIdempotency<T extends { status: number; body: unknown }>(
  db: Db,
  p: { organizationId: string; apiKeyId: string; key: string | undefined; method: string; path: string; body: unknown },
  run: () => Promise<T>,
): Promise<{ status: number; body: unknown; replayed: boolean }> {
  if (!p.key) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required for write requests");
  if (p.key.length < 8 || p.key.length > 200) throw new AppError("VALIDATION_FAILED", "Idempotency-Key must be 8-200 characters");
  const requestHash = sha256(`${p.method} ${p.path} ${stableStringify(p.body)}`);
  const inserted = await db
    .insert(schema.idempotencyKeys)
    .values({ organizationId: p.organizationId, apiKeyId: p.apiKeyId, key: p.key, method: p.method, path: p.path, requestHash, expiresAt: new Date(Date.now() + TTL_MS) })
    .onConflictDoNothing()
    .returning();

  if (!inserted[0]) {
    const [existing] = await db
      .select()
      .from(schema.idempotencyKeys)
      .where(and(eq(schema.idempotencyKeys.apiKeyId, p.apiKeyId), eq(schema.idempotencyKeys.key, p.key)));
    if (!existing) throw new AppError("CONFLICT", "Idempotency record vanished, retry");
    if (existing.requestHash !== requestHash) throw new AppError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used with a different request");
    if (existing.responseStatus === null) throw new AppError("CONFLICT", "A request with this Idempotency-Key is still in progress");
    return { status: existing.responseStatus, body: existing.responseBody, replayed: true };
  }

  try {
    const result = await run();
    await db
      .update(schema.idempotencyKeys)
      .set({ responseStatus: result.status, responseBody: result.body as object })
      .where(eq(schema.idempotencyKeys.id, inserted[0].id));
    return { ...result, replayed: false };
  } catch (e) {
    // Failed requests release the key so the client can fix the payload and retry with the same key.
    await db.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.id, inserted[0].id));
    throw e;
  }
}
