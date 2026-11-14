import { schema, type Db } from "@sichttakt/db";
import type { Actor } from "./rbac";

type AuditInput = {
  organizationId: string | null;
  workspaceId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
} & ({ actor: Actor } | { actorType: "user" | "api_key" | "system"; actorUserId?: string; actorApiKeyId?: string });

/** Append-only audit trail. Never store secrets or tokens in metadata. */
export async function audit(db: Db, a: AuditInput) {
  let actorType: "user" | "api_key" | "system";
  let actorUserId: string | undefined;
  let actorApiKeyId: string | undefined;
  if ("actor" in a) {
    actorType = a.actor.kind;
    if (a.actor.kind === "user") actorUserId = a.actor.userId;
    if (a.actor.kind === "api_key") actorApiKeyId = a.actor.apiKeyId;
  } else {
    actorType = a.actorType;
    actorUserId = a.actorUserId;
    actorApiKeyId = a.actorApiKeyId;
  }
  await db.insert(schema.auditLogs).values({
    organizationId: a.organizationId,
    workspaceId: a.workspaceId ?? null,
    actorType,
    actorUserId,
    actorApiKeyId,
    action: a.action,
    targetType: a.targetType,
    targetId: a.targetId,
    metadata: a.metadata ?? {},
    ip: a.ip ?? null,
  });
}
