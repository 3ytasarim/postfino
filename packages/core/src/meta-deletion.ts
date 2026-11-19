import { createHmac } from "node:crypto";
import { and, eq, inArray, or, sql, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import { safeEqual } from "./crypto";
import { audit } from "./audit";

// Meta "Data Deletion Request" and "Deauthorize" callbacks (App Dashboard → Settings → Basic / Facebook Login).
// Meta POSTs `signed_request` = "<base64url HMAC-SHA256 signature>.<base64url JSON payload>", signed with the app secret.
// Docs: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
// The payload's user_id is the Meta user id we stored at connect time (channels.meta.metaUserId / systemUserId).

const META_PLATFORMS = ["instagram_business", "facebook_page", "threads"] as const;
const MAX_AGE_S = 24 * 3600;

export type MetaSignedRequest = { algorithm: string; user_id: string; issued_at?: number; expires?: number };

/** Verifies and decodes a Meta signed_request. Throws UNAUTHENTICATED on a bad signature, algorithm or age. */
export function parseMetaSignedRequest(signedRequest: string, appSecret: string, now = Date.now()): MetaSignedRequest {
  const dot = signedRequest.indexOf(".");
  if (dot < 1) throw new AppError("UNAUTHENTICATED", "invalid_signed_request");
  const sig = signedRequest.slice(0, dot);
  const payload = signedRequest.slice(dot + 1);
  const expected = createHmac("sha256", appSecret).update(payload).digest("base64url");
  if (!safeEqual(sig.replace(/=+$/, ""), expected)) throw new AppError("UNAUTHENTICATED", "invalid_signature");
  let data: MetaSignedRequest;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MetaSignedRequest;
  } catch {
    throw new AppError("UNAUTHENTICATED", "invalid_payload");
  }
  if (String(data.algorithm).toUpperCase() !== "HMAC-SHA256") throw new AppError("UNAUTHENTICATED", "invalid_algorithm");
  if (!data.user_id || !/^\d{1,40}$/.test(String(data.user_id))) throw new AppError("UNAUTHENTICATED", "invalid_user");
  if (data.issued_at && now / 1000 - data.issued_at > MAX_AGE_S) throw new AppError("UNAUTHENTICATED", "request_too_old");
  return { ...data, user_id: String(data.user_id) };
}

/** Deterministic, non-guessable confirmation code for a request (no extra table needed; deletion runs synchronously). */
export function metaDeletionCode(appSecret: string, userId: string, issuedAt?: number) {
  return createHmac("sha256", appSecret).update(`deletion:${userId}:${issuedAt ?? ""}`).digest("hex").slice(0, 16).toUpperCase();
}

/**
 * Removes what Postfino holds for that Meta user: access tokens are destroyed, the channels are disconnected (pending
 * posts cancelled) and — for a deletion request — the profile data copied from Meta (name, username, picture) is erased.
 * Posts the customer wrote in Postfino stay with the customer's workspace; they are not Meta user data.
 */
export async function revokeMetaUser(db: Db, metaUserId: string, mode: "delete" | "deauthorize") {
  const rows = await db
    .select()
    .from(schema.channels)
    .where(
      and(
        inArray(schema.channels.platform, [...META_PLATFORMS]),
        or(sql`${schema.channels.meta}->>'metaUserId' = ${metaUserId}`, sql`${schema.channels.meta}->>'systemUserId' = ${metaUserId}`),
      ),
    );
  const now = new Date();
  for (const ch of rows) {
    await db.transaction(async (tx) => {
      await tx.update(schema.channelCredentials).set({ revokedAt: now, accessTokenEnc: "revoked", refreshTokenEnc: null, updatedAt: now }).where(eq(schema.channelCredentials.channelId, ch.id));
      const erase = mode === "delete" ? { displayName: "Gelöschtes Konto", username: null, avatarUrl: null, meta: { erasedAt: now.toISOString(), reason: "meta_data_deletion" } } : {};
      await tx.update(schema.channels).set({ status: "disconnected", disconnectedAt: ch.disconnectedAt ?? now, updatedAt: now, lastError: mode === "delete" ? "Daten auf Anfrage über Meta gelöscht" : "Zugriff bei Meta entfernt", ...erase }).where(eq(schema.channels.id, ch.id));
      await tx
        .update(schema.postTargets)
        .set({ status: "CANCELLED", errorCode: "CHANNEL_DISCONNECTED", updatedAt: now })
        .where(and(eq(schema.postTargets.channelId, ch.id), sql`${schema.postTargets.status} in ('DRAFT','PENDING_APPROVAL','APPROVED','SCHEDULED','FAILED_RETRYABLE','PREPARING_MEDIA')`));
    });
    await audit(db, { organizationId: ch.organizationId, workspaceId: ch.workspaceId, actorType: "system", action: mode === "delete" ? "channel.meta_data_deleted" : "channel.meta_deauthorized", targetType: "channel", targetId: ch.id, metadata: { platform: ch.platform } });
  }
  return { channels: rows.length };
}
