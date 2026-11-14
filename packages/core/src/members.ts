import { and, eq, isNull, isNotNull, sql, schema, type Db } from "@sichttakt/db";
import { AppError, type Role } from "@sichttakt/shared";
import { randomToken, sha256 } from "./crypto";
import { authorize } from "./tenancy";
import { assertLimit } from "./entitlements";
import { audit } from "./audit";
import { mailTemplates, type Mailer } from "./mailer";
import type { Actor } from "./rbac";

// Team management. Guards: no privilege escalation (you can only grant roles ≤ your own; only owners grant
// AGENCY_OWNER), the last owner cannot be removed/demoted, CLIENT_REVIEWER must be bound to one workspace.

export const ROLE_RANK: Record<Role, number> = {
  SUPER_ADMIN: 100,
  AGENCY_OWNER: 90,
  AGENCY_ADMIN: 80,
  MANAGER: 60,
  APPROVER: 40,
  EDITOR: 40,
  CLIENT_REVIEWER: 20,
  VIEWER: 10,
};
const INVITE_TTL_MS = 7 * 864e5;
const ORG_ONLY: Role[] = ["AGENCY_OWNER", "AGENCY_ADMIN"];

function actorRank(actor: Actor): number {
  if (actor.kind === "system") return 100;
  if (actor.kind !== "user") return 0;
  if (actor.isSuperAdmin) return 100;
  return actor.orgRole ? ROLE_RANK[actor.orgRole] : 0;
}

function assertCanGrant(actor: Actor, role: Role, workspaceId: string | null) {
  if (role === "SUPER_ADMIN") throw new AppError("FORBIDDEN", "SUPER_ADMIN cannot be granted via team management");
  if (role === "AGENCY_OWNER" && actorRank(actor) < ROLE_RANK.AGENCY_OWNER) throw new AppError("FORBIDDEN", "Only owners can grant AGENCY_OWNER");
  if (ROLE_RANK[role] > actorRank(actor)) throw new AppError("FORBIDDEN", "Cannot grant a role higher than your own");
  if (ORG_ONLY.includes(role) && workspaceId) throw new AppError("VALIDATION_FAILED", `${role} is an organization-wide role`);
  if (role === "CLIENT_REVIEWER" && !workspaceId) throw new AppError("VALIDATION_FAILED", "CLIENT_REVIEWER must be limited to one workspace");
}

async function assertWorkspaceInOrg(db: Db, orgId: string, workspaceId: string | null) {
  if (!workspaceId) return;
  const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(and(eq(schema.workspaces.id, workspaceId), eq(schema.workspaces.organizationId, orgId)));
  if (!ws) throw new AppError("NOT_FOUND", "Workspace not found");
}

export async function inviteMember(
  db: Db,
  mailer: Mailer,
  actor: Actor,
  p: { email: string; role: Role; workspaceId?: string | null; appUrl: string; organizationName: string; locale?: string },
) {
  authorize(actor, null, "members.manage");
  const email = p.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("VALIDATION_FAILED", "invalid_email");
  const workspaceId = p.workspaceId ?? null;
  assertCanGrant(actor, p.role, workspaceId);
  await assertWorkspaceInOrg(db, actor.organizationId, workspaceId);
  await assertLimit(db, actor.organizationId, "users");
  const [dupe] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .leftJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.organizationId, actor.organizationId), sql`(lower(${schema.memberships.inviteEmail}) = ${email} and ${schema.memberships.acceptedAt} is null) or lower(${schema.users.email}) = ${email}`));
  if (dupe) throw new AppError("CONFLICT", "already_member_or_invited");

  const token = randomToken(32);
  const [m] = await db
    .insert(schema.memberships)
    .values({ organizationId: actor.organizationId, workspaceId, role: p.role, inviteEmail: email, inviteTokenHash: sha256(token), invitedAt: new Date() })
    .returning();
  const link = `${p.appUrl.replace(/\/$/, "")}/invite/${token}`;
  const mail = await mailer.send({ to: email, ...mailTemplates.invite(p.locale ?? "de", p.organizationName, link) });
  await audit(db, { organizationId: actor.organizationId, workspaceId, actor, action: "member.invited", targetType: "membership", targetId: m!.id, metadata: { role: p.role, delivered: mail.delivered } });
  // The link is returned only when it could not be delivered (dev outbox) so an admin can share it manually.
  return { membershipId: m!.id, delivered: mail.delivered, link: mail.delivered ? null : link };
}

export async function getInvite(db: Db, token: string) {
  const [row] = await db
    .select({ m: schema.memberships, orgName: schema.organizations.name })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(and(eq(schema.memberships.inviteTokenHash, sha256(token)), isNull(schema.memberships.acceptedAt)));
  if (!row || !row.m.invitedAt || Date.now() - row.m.invitedAt.getTime() > INVITE_TTL_MS) return null;
  return { membershipId: row.m.id, email: row.m.inviteEmail!, role: row.m.role, organizationId: row.m.organizationId, organizationName: row.orgName };
}

export async function acceptInvite(db: Db, token: string, user: { id: string; email: string }) {
  const inv = await getInvite(db, token);
  if (!inv) throw new AppError("VALIDATION_FAILED", "invalid_or_expired_invite");
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw new AppError("FORBIDDEN", "invite_email_mismatch");
  await db
    .update(schema.memberships)
    .set({ userId: user.id, acceptedAt: new Date(), inviteTokenHash: null })
    .where(eq(schema.memberships.id, inv.membershipId));
  await audit(db, { organizationId: inv.organizationId, actorType: "user", actorUserId: user.id, action: "member.joined", targetType: "membership", targetId: inv.membershipId });
  return inv;
}

export async function listMembers(db: Db, actor: Actor) {
  authorize(actor, null, "members.manage");
  const rows = await db
    .select({ m: schema.memberships, user: { id: schema.users.id, name: schema.users.name, email: schema.users.email, totp: schema.users.totpEnabledAt } })
    .from(schema.memberships)
    .leftJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.organizationId, actor.organizationId));
  return rows.map((r) => ({
    id: r.m.id,
    role: r.m.role,
    workspaceId: r.m.workspaceId,
    pending: !r.m.acceptedAt,
    email: r.user?.email ?? r.m.inviteEmail,
    name: r.user?.name ?? null,
    twoFactor: Boolean(r.user?.totp),
    invitedAt: r.m.invitedAt,
    expired: !r.m.acceptedAt && r.m.invitedAt ? Date.now() - r.m.invitedAt.getTime() > INVITE_TTL_MS : false,
  }));
}

async function ownerCount(db: Db, orgId: string) {
  const rows = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.organizationId, orgId), eq(schema.memberships.role, "AGENCY_OWNER"), isNotNull(schema.memberships.acceptedAt), isNull(schema.memberships.workspaceId)));
  return rows.length;
}

async function loadMembership(db: Db, actor: Actor, membershipId: string) {
  const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.organizationId, actor.organizationId)));
  if (!m) throw new AppError("NOT_FOUND", "Member not found");
  if (ROLE_RANK[m.role] > actorRank(actor)) throw new AppError("FORBIDDEN", "Cannot manage a member with a higher role");
  return m;
}

export async function changeMemberRole(db: Db, actor: Actor, membershipId: string, role: Role) {
  authorize(actor, null, "members.manage");
  const m = await loadMembership(db, actor, membershipId);
  assertCanGrant(actor, role, m.workspaceId);
  if (m.role === "AGENCY_OWNER" && role !== "AGENCY_OWNER" && (await ownerCount(db, actor.organizationId)) <= 1)
    throw new AppError("CONFLICT", "last_owner");
  await db.update(schema.memberships).set({ role }).where(eq(schema.memberships.id, m.id));
  await audit(db, { organizationId: actor.organizationId, actor, action: "member.role_changed", targetType: "membership", targetId: m.id, metadata: { from: m.role, to: role } });
}

export async function removeMember(db: Db, actor: Actor, membershipId: string) {
  authorize(actor, null, "members.manage");
  const m = await loadMembership(db, actor, membershipId);
  if (m.role === "AGENCY_OWNER" && m.acceptedAt && (await ownerCount(db, actor.organizationId)) <= 1) throw new AppError("CONFLICT", "last_owner");
  await db.delete(schema.memberships).where(eq(schema.memberships.id, m.id));
  if (m.userId) {
    // End the removed user's sessions bound to this organization.
    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.userId, m.userId), eq(schema.sessions.activeOrganizationId, actor.organizationId), isNull(schema.sessions.revokedAt)));
  }
  await audit(db, { organizationId: actor.organizationId, actor, action: "member.removed", targetType: "membership", targetId: m.id, metadata: { role: m.role } });
}
