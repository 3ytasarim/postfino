import { and, eq, isNull, schema, type Db } from "@sichttakt/db";
import { AppError, PLAN_DEFAULTS, type Role } from "@sichttakt/shared";
import { can, SCOPE_PERMISSIONS, type Actor, type Permission } from "./rbac";
import { audit } from "./audit";

// Every service entry point calls `authorize(actor, workspaceId, permission)` first. It is the single
// place that enforces tenant isolation (organization match) and workspace scoping.

export function authorize(actor: Actor, workspaceId: string | null, permission: Permission, workspaceOrgId?: string): void {
  if (workspaceOrgId && workspaceOrgId !== actor.organizationId) throw new AppError("NOT_FOUND", "Workspace not found");
  if (actor.kind === "system") return;
  if (actor.kind === "api_key") {
    if (workspaceId && !actor.workspaceIds.includes(workspaceId)) throw new AppError("WORKSPACE_NOT_ALLOWED", "API key is not allowed for this workspace");
    const ok = actor.scopes.some((s) => SCOPE_PERMISSIONS[s].includes(permission));
    if (!ok) throw new AppError("INSUFFICIENT_SCOPE", `Missing scope for ${permission}`);
    return;
  }
  if (actor.isSuperAdmin) return;
  const role: Role | null = (workspaceId ? actor.workspaceRoles[workspaceId] : undefined) ?? actor.orgRole;
  if (!role || !can(role, permission)) throw new AppError("FORBIDDEN", `Not allowed: ${permission}`);
}

/** Loads a workspace and verifies it belongs to the actor's organization (404 otherwise — no existence leak). */
export async function loadWorkspace(db: Db, actor: Actor, workspaceId: string, permission: Permission) {
  const [ws] = await db
    .select()
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.id, workspaceId), eq(schema.workspaces.organizationId, actor.organizationId), isNull(schema.workspaces.archivedAt)));
  if (!ws) throw new AppError("NOT_FOUND", "Workspace not found");
  authorize(actor, ws.id, permission, ws.organizationId);
  return ws;
}

export async function listWorkspacesFor(db: Db, actor: Actor) {
  const rows = await db
    .select()
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.organizationId, actor.organizationId), isNull(schema.workspaces.archivedAt)));
  if (actor.kind === "api_key") return rows.filter((w) => actor.workspaceIds.includes(w.id));
  if (actor.kind === "user" && !actor.isSuperAdmin && !actor.orgRole) return rows.filter((w) => actor.workspaceRoles[w.id]);
  return rows;
}

export async function buildUserActor(db: Db, userId: string, organizationId: string): Promise<Actor | null> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return null;
  const ms = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.organizationId, organizationId)));
  if (ms.length === 0 && !user.isSuperAdmin) return null;
  const orgRole = ms.find((m) => !m.workspaceId)?.role ?? null;
  const workspaceRoles: Record<string, Role> = {};
  for (const m of ms) if (m.workspaceId) workspaceRoles[m.workspaceId] = m.role;
  return { kind: "user", userId, organizationId, isSuperAdmin: user.isSuperAdmin, orgRole, workspaceRoles };
}

export async function listOrganizationsForUser(db: Db, userId: string) {
  return db
    .selectDistinct({ id: schema.organizations.id, name: schema.organizations.name, slug: schema.organizations.slug })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(eq(schema.memberships.userId, userId));
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "org";

export async function createOrganization(
  db: Db,
  p: { ownerUserId: string; name: string; workspaceName: string; plan?: keyof typeof PLAN_DEFAULTS; timezone?: string; locale?: string },
) {
  return db.transaction(async (tx) => {
    const base = slugify(p.name);
    const slug = `${base}-${crypto.randomUUID().slice(0, 6)}`;
    const [org] = await tx
      .insert(schema.organizations)
      .values({ name: p.name, slug, timezone: p.timezone ?? "Europe/Berlin", locale: p.locale ?? "de" })
      .returning();
    const [ws] = await tx
      .insert(schema.workspaces)
      .values({ organizationId: org!.id, name: p.workspaceName, slug: slugify(p.workspaceName), timezone: p.timezone ?? "Europe/Berlin" })
      .returning();
    await tx.insert(schema.memberships).values({ organizationId: org!.id, userId: p.ownerUserId, role: "AGENCY_OWNER", acceptedAt: new Date() });
    const now = new Date();
    await tx.insert(schema.subscriptions).values({
      organizationId: org!.id,
      planCode: p.plan ?? "starter",
      status: "trialing",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 14 * 864e5),
    });
    await audit(tx as unknown as Db, { organizationId: org!.id, actorType: "user", actorUserId: p.ownerUserId, action: "organization.created", targetType: "organization", targetId: org!.id });
    return { organization: org!, workspace: ws! };
  });
}

export async function createWorkspace(db: Db, actor: Actor, p: { name: string; timezone?: string; isClient?: boolean; approvalRequired?: boolean }) {
  authorize(actor, null, "workspace.create");
  const { assertLimit } = await import("./entitlements");
  await assertLimit(db, actor.organizationId, "workspaces");
  const [ws] = await db
    .insert(schema.workspaces)
    .values({
      organizationId: actor.organizationId,
      name: p.name,
      slug: `${slugify(p.name)}-${crypto.randomUUID().slice(0, 4)}`,
      timezone: p.timezone ?? "Europe/Berlin",
      isClient: p.isClient ?? false,
      approvalRequired: p.approvalRequired ?? false,
    })
    .returning();
  await audit(db, { organizationId: actor.organizationId, workspaceId: ws!.id, actor, action: "workspace.created", targetType: "workspace", targetId: ws!.id });
  return ws!;
}

export async function updateWorkspace(db: Db, actor: Actor, workspaceId: string, p: { name?: string; timezone?: string; approvalRequired?: boolean }) {
  const ws = await loadWorkspace(db, actor, workspaceId, "workspace.manage");
  const { isValidTimeZone } = await import("@sichttakt/shared");
  if (p.timezone && !isValidTimeZone(p.timezone)) throw new AppError("VALIDATION_FAILED", "Unknown timezone");
  if (p.name !== undefined && p.name.trim().length < 2) throw new AppError("VALIDATION_FAILED", "Name too short");
  const [row] = await db
    .update(schema.workspaces)
    .set({ name: p.name?.trim() ?? ws.name, timezone: p.timezone ?? ws.timezone, approvalRequired: p.approvalRequired ?? ws.approvalRequired, updatedAt: new Date() })
    .where(eq(schema.workspaces.id, ws.id))
    .returning();
  await audit(db, { organizationId: ws.organizationId, workspaceId: ws.id, actor, action: "workspace.updated", targetType: "workspace", targetId: ws.id, metadata: { approvalRequired: row!.approvalRequired, timezone: row!.timezone } });
  return row!;
}
