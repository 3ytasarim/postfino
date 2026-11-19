import { and, eq, inArray, isNotNull, ne, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import { decrypt, verifyPassword, type Keyring } from "./crypto";
import { audit } from "./audit";
import type { AdapterRegistry } from "./channels";
import type { StorageDriver } from "./storage";

// Self-service account deletion (Settings → "Konto löschen"; GDPR Art. 17, Meta platform terms).
//  • The user confirms with the password (or, for Google/Apple sign-in accounts without a password, the email address).
//  • Organisations in which the user is the only member are deleted completely: channels are revoked at the network
//    (best effort), every row of the organisation goes (FK cascade) and its media/report files are removed from storage.
//  • Organisations with other members stay; the user's membership is removed. If the user is the only owner there,
//    deletion is refused until ownership is handed over, so a team never ends up without an owner.
//  • A paid subscription must be cancelled first (billing is never cancelled implicitly).
//  • Finally the user row is deleted (sessions, identities, tokens, notifications cascade), freeing the email address.

const OWNER = "AGENCY_OWNER";
const PAID_STATUSES = ["active", "trialing", "past_due"];

export type AccountDeletionPlan = {
  deleteOrganizations: { id: string; name: string }[];
  leaveOrganizations: { id: string; name: string }[];
  blockedByOwnership: { id: string; name: string }[];
  blockedBySubscription: { id: string; name: string }[];
};

/** What deleting this user would do (shown in the UI before confirming, and re-checked on delete). */
export async function planAccountDeletion(db: Db, userId: string): Promise<AccountDeletionPlan> {
  const mine = await db
    .select({ organizationId: schema.memberships.organizationId, role: schema.memberships.role, name: schema.organizations.name })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(eq(schema.memberships.userId, userId));
  const orgs = new Map<string, { name: string; owner: boolean }>();
  for (const m of mine) {
    const o = orgs.get(m.organizationId) ?? { name: m.name, owner: false };
    o.owner ||= m.role === OWNER;
    orgs.set(m.organizationId, o);
  }
  const plan: AccountDeletionPlan = { deleteOrganizations: [], leaveOrganizations: [], blockedByOwnership: [], blockedBySubscription: [] };
  for (const [id, o] of orgs) {
    const others = await db
      .select({ userId: schema.memberships.userId, role: schema.memberships.role })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.organizationId, id), isNotNull(schema.memberships.userId), ne(schema.memberships.userId, userId)));
    const ref = { id, name: o.name };
    if (others.length === 0) {
      const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, id));
      if (sub?.externalSubscriptionId && PAID_STATUSES.includes(sub.status)) plan.blockedBySubscription.push(ref);
      else plan.deleteOrganizations.push(ref);
    } else if (o.owner && !others.some((x) => x.role === OWNER)) plan.blockedByOwnership.push(ref);
    else plan.leaveOrganizations.push(ref);
  }
  return plan;
}

export async function deleteOwnAccount(
  svc: { db: Db; ring: Keyring; registry: AdapterRegistry; storage: StorageDriver },
  userId: string,
  confirm: { password?: string; email?: string },
) {
  const { db } = svc;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || user.deletedAt) throw new AppError("NOT_FOUND", "user_not_found");
  if (user.isSuperAdmin) throw new AppError("FORBIDDEN", "super_admin");
  const ok = user.passwordHash
    ? Boolean(confirm.password) && (await verifyPassword(confirm.password!, user.passwordHash))
    : (confirm.email ?? "").trim().toLowerCase() === user.email.toLowerCase();
  if (!ok) throw new AppError("UNAUTHENTICATED", "confirmation_failed");

  const plan = await planAccountDeletion(db, userId);
  if (plan.blockedByOwnership.length) throw new AppError("CONFLICT", "owner_has_members", { organizations: plan.blockedByOwnership });
  if (plan.blockedBySubscription.length) throw new AppError("CONFLICT", "active_subscription", { organizations: plan.blockedBySubscription });

  const files: string[] = [];
  for (const org of plan.deleteOrganizations) {
    // 1. revoke at the networks while the tokens still exist (best effort; the local copy is destroyed anyway)
    const chans = await db
      .select({ ch: schema.channels, cred: schema.channelCredentials })
      .from(schema.channels)
      .leftJoin(schema.channelCredentials, eq(schema.channelCredentials.channelId, schema.channels.id))
      .where(eq(schema.channels.organizationId, org.id));
    for (const { ch, cred } of chans) {
      if (!cred || cred.accessTokenEnc === "revoked" || ch.isSandbox) continue;
      try {
        await svc.registry.get(ch.platform).disconnect({ accessToken: decrypt(svc.ring, cred.accessTokenEnc), externalId: ch.externalId, meta: ch.meta });
      } catch {
        /* provider unreachable or not configured: the token is deleted with the organisation below */
      }
    }
    // 2. remember the stored files, then delete the organisation (post_media → media_assets is RESTRICT, so it goes first)
    const assets = await db.select({ k: schema.mediaAssets.storageKey }).from(schema.mediaAssets).where(eq(schema.mediaAssets.organizationId, org.id));
    const variants = await db.select({ k: schema.mediaVariants.storageKey }).from(schema.mediaVariants).where(eq(schema.mediaVariants.organizationId, org.id));
    const reports = await db.select({ k: schema.reports.storageKey }).from(schema.reports).where(eq(schema.reports.organizationId, org.id));
    files.push(...[...assets, ...variants, ...reports].map((r) => r.k).filter((k): k is string => Boolean(k)));
    await db.transaction(async (tx) => {
      await tx.delete(schema.postMedia).where(eq(schema.postMedia.organizationId, org.id));
      await tx.delete(schema.organizations).where(eq(schema.organizations.id, org.id));
    });
  }

  // 3. leave the remaining organisations (their content stays with the team) and delete the user
  const leave = plan.leaveOrganizations.map((o) => o.id);
  await db.transaction(async (tx) => {
    if (leave.length) await tx.delete(schema.memberships).where(and(eq(schema.memberships.userId, userId), inArray(schema.memberships.organizationId, leave)));
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });
  for (const id of leave) await audit(db, { organizationId: id, actorType: "system", action: "member.account_deleted", targetType: "user", targetId: userId });

  // 4. files last: a failure here must not leave a half-deleted account behind
  for (const key of files) await svc.storage.delete(key).catch(() => undefined);

  return { email: user.email, locale: user.locale, deletedOrganizations: plan.deleteOrganizations.length, leftOrganizations: leave.length };
}
