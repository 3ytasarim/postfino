import { and, eq, isNull, schema, type Db } from "@sichttakt/db";
import { AppError, type WebhookEvent } from "@sichttakt/shared";
import { decrypt, encrypt, hmacSha256Hex, randomToken, safeEqual, type Keyring } from "./crypto";
import { enqueue } from "./queue";
import { assertPublicUrl } from "./net-guard";
import { authorize } from "./tenancy";
import { assertFeature } from "./entitlements";
import { audit } from "./audit";
import type { Actor } from "./rbac";

// Signature scheme (docs/WEBHOOK_SECURITY.md):
//   SichtTakt-Signature: t=<unix seconds>,v1=<hex hmac_sha256(secret, "<t>.<raw body>")>
//   SichtTakt-Event-Id: <uuid>   — receivers dedupe on this (replay prevention)
// Receivers reject timestamps older than 5 minutes.

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, body: string, timestampSec: number) {
  return `t=${timestampSec},v1=${hmacSha256Hex(secret, `${timestampSec}.${body}`)}`;
}

export function verifySignature(secret: string, body: string, header: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(nowSec - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  return safeEqual(hmacSha256Hex(secret, `${t}.${body}`), parts.v1);
}

export async function createWebhook(db: Db, ring: Keyring, actor: Actor, p: { url: string; events: WebhookEvent[]; workspaceId?: string; description?: string }) {
  authorize(actor, p.workspaceId ?? null, "webhooks.manage");
  await assertFeature(db, actor.organizationId, "webhooks");
  if (p.workspaceId) {
    const [ws] = await db.select().from(schema.workspaces).where(and(eq(schema.workspaces.id, p.workspaceId), eq(schema.workspaces.organizationId, actor.organizationId)));
    if (!ws) throw new AppError("NOT_FOUND", "Workspace not found");
  }
  const secret = `whsec_${randomToken(32)}`;
  const enc = encrypt(ring, secret);
  const [row] = await db
    .insert(schema.webhookSubscriptions)
    .values({
      organizationId: actor.organizationId,
      workspaceId: p.workspaceId ?? null,
      url: p.url,
      events: p.events,
      secretEnc: enc.value,
      keyVersion: enc.version,
      description: p.description,
      createdByApiKeyId: actor.kind === "api_key" ? actor.apiKeyId : null,
    })
    .returning();
  await audit(db, { organizationId: actor.organizationId, actor, action: "webhook.created", targetType: "webhook", targetId: row!.id, metadata: { url: p.url, events: p.events } });
  return { webhook: webhookView(row!), secret };
}

export async function listWebhooks(db: Db, actor: Actor) {
  authorize(actor, null, "webhooks.manage");
  const rows = await db
    .select()
    .from(schema.webhookSubscriptions)
    .where(and(eq(schema.webhookSubscriptions.organizationId, actor.organizationId), isNull(schema.webhookSubscriptions.disabledAt)));
  return rows
    .filter((r) => actor.kind !== "api_key" || !r.workspaceId || actor.workspaceIds.includes(r.workspaceId))
    .map(webhookView);
}

export async function deleteWebhook(db: Db, actor: Actor, id: string) {
  authorize(actor, null, "webhooks.manage");
  const [row] = await db
    .update(schema.webhookSubscriptions)
    .set({ active: false, disabledAt: new Date() })
    .where(and(eq(schema.webhookSubscriptions.id, id), eq(schema.webhookSubscriptions.organizationId, actor.organizationId), isNull(schema.webhookSubscriptions.disabledAt)))
    .returning();
  if (!row) throw new AppError("NOT_FOUND", "Webhook not found");
  await audit(db, { organizationId: actor.organizationId, actor, action: "webhook.deleted", targetType: "webhook", targetId: id });
}

const webhookView = (r: typeof schema.webhookSubscriptions.$inferSelect) => ({
  id: r.id,
  url: r.url,
  events: r.events,
  workspace_id: r.workspaceId,
  description: r.description,
  active: r.active,
  created_at: r.createdAt,
});

/** Fan an event out to matching subscriptions: one delivery row + one queue job each (dedup per subscription+event). */
export async function emitEvent(db: Db, p: { organizationId: string; workspaceId?: string | null; event: WebhookEvent; data: Record<string, unknown>; eventId?: string }) {
  const subs = await db
    .select()
    .from(schema.webhookSubscriptions)
    .where(and(eq(schema.webhookSubscriptions.organizationId, p.organizationId), eq(schema.webhookSubscriptions.active, true)));
  const eventId = p.eventId ?? crypto.randomUUID();
  const created = new Date().toISOString();
  for (const s of subs) {
    if (!s.events.includes(p.event)) continue;
    if (s.workspaceId && p.workspaceId && s.workspaceId !== p.workspaceId) continue;
    const payload = { id: eventId, type: p.event, created_at: created, organization_id: p.organizationId, workspace_id: p.workspaceId ?? null, data: p.data };
    const [d] = await db
      .insert(schema.webhookDeliveries)
      .values({ organizationId: p.organizationId, subscriptionId: s.id, event: p.event, eventId, payload })
      .onConflictDoNothing()
      .returning();
    if (d) await enqueue(db, { kind: "deliver_webhook", organizationId: p.organizationId, payload: { deliveryId: d.id }, dedupKey: `wh:${d.id}`, maxAttempts: 8 });
  }
  return eventId;
}

export async function deliverWebhook(db: Db, ring: Keyring, deliveryId: string, http: typeof fetch = fetch, allowPrivateUrls = false): Promise<{ ok: boolean; retryable: boolean; error?: string }> {
  const [d] = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, deliveryId));
  if (!d || d.status === "delivered") return { ok: true, retryable: false };
  const [sub] = await db.select().from(schema.webhookSubscriptions).where(eq(schema.webhookSubscriptions.id, d.subscriptionId));
  if (!sub || !sub.active) return { ok: true, retryable: false };
  const secret = decrypt(ring, sub.secretEnc);
  const body = JSON.stringify(d.payload);
  const ts = Math.floor(Date.now() / 1000);
  let status = 0;
  let error: string | undefined;
  try {
    await assertPublicUrl(sub.url, allowPrivateUrls);
    const res = await http(sub.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "SichtTakt-Webhooks/1",
        "sichttakt-event": d.event,
        "sichttakt-event-id": d.eventId,
        "sichttakt-signature": signPayload(secret, body, ts),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = (e as Error).message;
  }
  const ok = status >= 200 && status < 300;
  await db
    .update(schema.webhookDeliveries)
    .set({ status: ok ? "delivered" : "failed", attempts: d.attempts + 1, lastStatusCode: status || null, lastError: error ?? null, deliveredAt: ok ? new Date() : null })
    .where(eq(schema.webhookDeliveries.id, d.id));
  // 4xx except 408/429 = receiver rejected permanently.
  const retryable = !ok && (status === 0 || status >= 500 || status === 408 || status === 429);
  return { ok, retryable, error };
}
