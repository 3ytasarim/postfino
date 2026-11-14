import { and, eq, isNull, lte, isNotNull, sql, schema, type Db } from "@sichttakt/db";
import { ProviderError } from "@sichttakt/social-adapters";
import { decrypt, encrypt, type Keyring } from "./crypto";
import { enqueue, completeJob, failJob, type Job } from "./queue";
import { emitEvent } from "./webhooks";
import { audit } from "./audit";
import { saveRefreshedToken, type AdapterRegistry } from "./channels";

// Long-lived Meta user tokens last ~60 days. We refresh 10 days before expiry; if the provider refuses,
// the channel becomes `needs_reauth` (publishing stops via getChannelAuthForPublish) and owners are notified.

const REFRESH_WINDOW_MS = 10 * 864e5;

/** Enqueues one refresh job per expiring credential per day (idempotent via dedup key). */
export async function scheduleTokenRefreshes(db: Db, now = new Date()) {
  const due = await db
    .select({ channelId: schema.channelCredentials.channelId, organizationId: schema.channelCredentials.organizationId })
    .from(schema.channelCredentials)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.channelCredentials.channelId))
    .where(
      and(
        isNull(schema.channelCredentials.revokedAt),
        isNotNull(schema.channelCredentials.expiresAt),
        lte(schema.channelCredentials.expiresAt, new Date(now.getTime() + REFRESH_WINDOW_MS)),
        eq(schema.channels.status, "active"),
        eq(schema.channels.isSandbox, false),
      ),
    );
  const day = now.toISOString().slice(0, 10);
  let queued = 0;
  for (const d of due) {
    const r = await enqueue(db, { kind: "refresh_token", organizationId: d.organizationId, payload: { channelId: d.channelId }, dedupKey: `refresh:${d.channelId}:${day}`, maxAttempts: 4 });
    if (!r.deduplicated) queued++;
  }
  return { due: due.length, queued };
}

export async function processRefreshJob(deps: { db: Db; ring: Keyring; registry: AdapterRegistry }, job: Job): Promise<"refreshed" | "skipped" | "needs_reauth" | "retry"> {
  const { db, ring, registry } = deps;
  const channelId = String(job.payload.channelId);
  const [row] = await db
    .select({ ch: schema.channels, cred: schema.channelCredentials })
    .from(schema.channels)
    .innerJoin(schema.channelCredentials, eq(schema.channelCredentials.channelId, schema.channels.id))
    .where(eq(schema.channels.id, channelId));
  if (!row || row.cred.revokedAt || row.ch.status !== "active") {
    await completeJob(db, job.id);
    return "skipped";
  }
  try {
    const r = await registry.get(row.ch.platform).refreshToken({ accessToken: decrypt(ring, row.cred.accessTokenEnc), refreshToken: row.cred.refreshTokenEnc ? decrypt(ring, row.cred.refreshTokenEnc) : undefined, externalId: row.ch.externalId, meta: row.ch.meta });
    await saveRefreshedToken(db, ring, row.cred.id, { ...r, expiresAt: r.expiresAt ?? row.cred.expiresAt ?? undefined });
    await db.update(schema.channels).set({ lastHealthCheckAt: new Date(), lastError: null }).where(eq(schema.channels.id, channelId));
    await audit(db, { organizationId: row.ch.organizationId, workspaceId: row.ch.workspaceId, actorType: "system", action: "channel.token_refreshed", targetType: "channel", targetId: channelId });
    await completeJob(db, job.id);
    return "refreshed";
  } catch (e) {
    const retryable = e instanceof ProviderError ? e.retryable : false;
    const { dead } = await failJob(db, job, (e as Error).message, { retryable });
    if (!dead) return "retry";
    await db.update(schema.channels).set({ status: "needs_reauth", lastError: (e as Error).message.slice(0, 500), updatedAt: new Date() }).where(eq(schema.channels.id, channelId));
    const admins = await db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.organizationId, row.ch.organizationId), isNull(schema.memberships.workspaceId), sql`${schema.memberships.role} in ('AGENCY_OWNER','AGENCY_ADMIN')`));
    for (const a of admins)
      if (a.userId)
        await db.insert(schema.notifications).values({ organizationId: row.ch.organizationId, workspaceId: row.ch.workspaceId, userId: a.userId, kind: "channel_reauth", title: `Neu verbinden: ${row.ch.displayName}`, body: "Der Zugriffstoken konnte nicht erneuert werden. Geplante Beiträge für diesen Kanal werden nicht veröffentlicht.", link: "/app/channels" });
    await emitEvent(db, { organizationId: row.ch.organizationId, workspaceId: row.ch.workspaceId, event: "account.disconnected", data: { account_id: channelId, platform: row.ch.platform, reason: "reauth_required" } });
    return "needs_reauth";
  }
}
