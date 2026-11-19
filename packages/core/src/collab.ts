import { and, asc, desc, eq, inArray, isNull, lt, or, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import { randomToken, sha256 } from "./crypto";
import { authorize } from "./tenancy";
import { getPost, decideApproval } from "./posts";
import { audit } from "./audit";
import type { Actor } from "./rbac";
import { mailTemplates, type Mailer } from "./mailer";
import type { StorageDriver } from "./storage";

// Collaboration: client review portal (token link, no account), internal notes with
// @mentions, approval reminders. A review link is bound to ONE post version — any content edit invalidates it.

const REVIEW_TTL_MS = 14 * 864e5;

export async function createReviewLink(db: Db, actor: Actor, postId: string, appUrl: string) {
  const { post } = await getPost(db, actor, postId);
  authorize(actor, post.workspaceId, "posts.write");
  if (post.status !== "PENDING_APPROVAL") throw new AppError("INVALID_STATE_TRANSITION", "Only posts awaiting approval can be shared for review");
  const [req] = await db
    .select()
    .from(schema.approvalRequests)
    .where(and(eq(schema.approvalRequests.postId, post.id), eq(schema.approvalRequests.status, "open"), eq(schema.approvalRequests.postVersion, post.currentVersion)));
  if (!req) throw new AppError("CONFLICT", "No open approval request for the current version");
  const token = randomToken(24);
  await db.update(schema.approvalRequests).set({ reviewTokenHash: sha256(token), reviewTokenExpiresAt: new Date(Date.now() + REVIEW_TTL_MS) }).where(eq(schema.approvalRequests.id, req.id));
  await audit(db, { organizationId: post.organizationId, workspaceId: post.workspaceId, actor, action: "review_link.created", targetType: "post", targetId: post.id, metadata: { version: post.currentVersion } });
  return { url: `${appUrl.replace(/\/$/, "")}/review/${token}`, expiresAt: new Date(Date.now() + REVIEW_TTL_MS) };
}

async function loadReview(db: Db, token: string) {
  const [row] = await db
    .select({ req: schema.approvalRequests, post: schema.posts, ws: schema.workspaces })
    .from(schema.approvalRequests)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.approvalRequests.postId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.posts.workspaceId))
    .where(eq(schema.approvalRequests.reviewTokenHash, sha256(token)));
  if (!row || row.req.status !== "open" || !row.req.reviewTokenExpiresAt || row.req.reviewTokenExpiresAt < new Date()) return null;
  if (row.post.currentVersion !== row.req.postVersion || row.post.status !== "PENDING_APPROVAL") return null;
  return row;
}

/** Public, read-only view for the review portal. Media are exposed only as short-lived signed URLs. */
export async function getReview(db: Db, storage: StorageDriver, token: string) {
  const row = await loadReview(db, token);
  if (!row) return null;
  const media = await db
    .select({ role: schema.postMedia.role, position: schema.postMedia.position, kind: schema.mediaAssets.kind, key: schema.mediaAssets.storageKey, mime: schema.mediaAssets.mimeType })
    .from(schema.postMedia)
    .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, schema.postMedia.assetId))
    .where(eq(schema.postMedia.postId, row.post.id));
  const targets = await db
    .select({ name: schema.channels.displayName, platform: schema.channels.platform, caption: schema.postTargets.captionOverride })
    .from(schema.postTargets)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.postTargets.channelId))
    .where(eq(schema.postTargets.postId, row.post.id));
  const notes = await db
    .select({ body: schema.internalNotes.body, createdAt: schema.internalNotes.createdAt })
    .from(schema.internalNotes)
    .where(and(eq(schema.internalNotes.postId, row.post.id), eq(schema.internalNotes.visibleToClient, true)))
    .orderBy(asc(schema.internalNotes.createdAt));
  return {
    organizationId: row.post.organizationId,
    workspace: row.ws.name,
    timezone: row.ws.timezone,
    post: { type: row.post.type, caption: row.post.caption, scheduledAt: row.post.scheduledAt, version: row.post.currentVersion, coverMode: row.post.coverMode },
    media: media.sort((a, b) => (a.role === b.role ? a.position - b.position : a.role.localeCompare(b.role))).map((m) => ({ role: m.role, kind: m.kind, mime: m.mime, url: storage.signedUrl(m.key, 1800) })),
    targets,
    notes,
  };
}

export async function decideViaPortal(db: Db, token: string, p: { decision: "approved" | "changes_requested"; reviewerName: string; comment?: string }) {
  const row = await loadReview(db, token);
  if (!row) throw new AppError("NOT_FOUND", "review_link_invalid_or_expired");
  const name = p.reviewerName.trim().slice(0, 120);
  if (!name) throw new AppError("VALIDATION_FAILED", "reviewer_name_required");
  if (p.decision === "changes_requested" && !p.comment?.trim()) throw new AppError("VALIDATION_FAILED", "comment_required_for_changes");
  const system: Actor = { kind: "system", organizationId: row.post.organizationId };
  const out = await decideApproval(db, system, row.post.id, p.decision, p.comment?.slice(0, 4000), { via: "portal", reviewerName: name });
  await audit(db, { organizationId: row.post.organizationId, workspaceId: row.post.workspaceId, actorType: "system", action: `post.portal_${p.decision}`, targetType: "post", targetId: row.post.id, metadata: { reviewer: name } });
  // Tell the team.
  await notifyWorkspace(db, row.post.organizationId, row.post.workspaceId, ["AGENCY_OWNER", "AGENCY_ADMIN", "MANAGER", "EDITOR"], {
    kind: "review_decision",
    title: `${name}: ${p.decision === "approved" ? "Freigegeben" : "Änderungen angefragt"}`,
    body: p.comment?.slice(0, 200),
    link: `/app/posts/${row.post.id}`,
  });
  return out;
}

export async function listDecisions(db: Db, actor: Actor, postId: string) {
  const { post } = await getPost(db, actor, postId);
  return db
    .select({ d: schema.approvalDecisions, version: schema.approvalRequests.postVersion, userName: schema.users.name })
    .from(schema.approvalDecisions)
    .innerJoin(schema.approvalRequests, eq(schema.approvalRequests.id, schema.approvalDecisions.approvalRequestId))
    .leftJoin(schema.users, eq(schema.users.id, schema.approvalDecisions.decidedByUserId))
    .where(eq(schema.approvalRequests.postId, post.id))
    .orderBy(desc(schema.approvalDecisions.createdAt));
}

// ── Notes & mentions ──
async function workspaceMembers(db: Db, orgId: string, workspaceId: string) {
  return db
    .select({ userId: schema.memberships.userId, role: schema.memberships.role, name: schema.users.name, email: schema.users.email })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.organizationId, orgId), or(isNull(schema.memberships.workspaceId), eq(schema.memberships.workspaceId, workspaceId))));
}

async function notifyWorkspace(db: Db, orgId: string, workspaceId: string, roles: string[], n: { kind: string; title: string; body?: string; link?: string }) {
  const members = await workspaceMembers(db, orgId, workspaceId);
  const ids = [...new Set(members.filter((m) => roles.includes(m.role) && m.userId).map((m) => m.userId!))];
  if (ids.length) await db.insert(schema.notifications).values(ids.map((userId) => ({ organizationId: orgId, workspaceId, userId, ...n })));
  return ids;
}

/** Mentions: `@max.mustermann@firma.de` (email) or `@Max` (first word of the display name, case-insensitive). */
export function parseMentions(body: string): string[] {
  return [...body.matchAll(/(^|\s)@([\p{L}\p{N}._+-]+(?:@[\w.-]+\.[a-z]{2,})?)/giu)].map((m) => m[2]!.toLowerCase());
}

export async function addNote(db: Db, actor: Actor, p: { postId?: string; ideaId?: string; body: string; visibleToClient?: boolean }) {
  if (actor.kind !== "user") throw new AppError("FORBIDDEN", "Notes are written by users");
  const body = p.body.trim();
  if (!body || body.length > 4000) throw new AppError("VALIDATION_FAILED", "Note must be 1–4000 characters");
  let workspaceId: string;
  let link: string;
  if (p.postId) {
    const { post } = await getPost(db, actor, p.postId);
    workspaceId = post.workspaceId;
    link = `/app/posts/${post.id}`;
  } else if (p.ideaId) {
    const [i] = await db.select().from(schema.contentIdeas).where(and(eq(schema.contentIdeas.id, p.ideaId), eq(schema.contentIdeas.organizationId, actor.organizationId)));
    if (!i) throw new AppError("NOT_FOUND", "Idea not found");
    workspaceId = i.workspaceId;
    link = `/app/ideas?idea=${i.id}`;
  } else throw new AppError("VALIDATION_FAILED", "postId or ideaId required");
  authorize(actor, workspaceId, "posts.read");
  const handles = parseMentions(body);
  const members = await workspaceMembers(db, actor.organizationId, workspaceId);
  const mentioned = [
    ...new Set(
      members
        .filter((m) => m.userId && m.userId !== actor.userId && handles.some((h) => h === m.email.toLowerCase() || h === m.name.split(/\s+/)[0]!.toLowerCase()))
        .map((m) => m.userId!),
    ),
  ];
  const [note] = await db
    .insert(schema.internalNotes)
    .values({ organizationId: actor.organizationId, workspaceId, postId: p.postId, ideaId: p.ideaId, authorUserId: actor.userId, body, mentions: mentioned, visibleToClient: p.visibleToClient ?? false })
    .returning();
  if (mentioned.length)
    await db.insert(schema.notifications).values(mentioned.map((userId) => ({ organizationId: actor.organizationId, workspaceId, userId, kind: "mention", title: "Du wurdest erwähnt", body: body.slice(0, 200), link })));
  return note!;
}

export async function listNotes(db: Db, actor: Actor, p: { postId?: string; ideaId?: string }) {
  if (p.postId) await getPost(db, actor, p.postId);
  const rows = await db
    .select({ n: schema.internalNotes, author: schema.users.name })
    .from(schema.internalNotes)
    .innerJoin(schema.users, eq(schema.users.id, schema.internalNotes.authorUserId))
    .where(and(eq(schema.internalNotes.organizationId, actor.organizationId), p.postId ? eq(schema.internalNotes.postId, p.postId) : eq(schema.internalNotes.ideaId, p.ideaId ?? "00000000-0000-0000-0000-000000000000")))
    .orderBy(asc(schema.internalNotes.createdAt));
  if (p.ideaId && rows[0]) authorize(actor, rows[0].n.workspaceId, "posts.read");
  // Client reviewers only ever see client-visible notes.
  const isClient = actor.kind === "user" && !actor.isSuperAdmin && !actor.orgRole && Object.values(actor.workspaceRoles).every((r) => r === "CLIENT_REVIEWER");
  return rows.filter((r) => !isClient || r.n.visibleToClient);
}

// ── Reminders ──
/** Open approval requests older than 24h get one reminder per 24h (in-app + email when SMTP is configured). */
export async function sendApprovalReminders(db: Db, mailer: Mailer | null, appUrl: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - 864e5);
  const open = await db
    .select({ req: schema.approvalRequests, caption: schema.posts.caption })
    .from(schema.approvalRequests)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.approvalRequests.postId))
    .where(and(eq(schema.approvalRequests.status, "open"), lt(schema.approvalRequests.createdAt, cutoff), or(isNull(schema.approvalRequests.remindedAt), lt(schema.approvalRequests.remindedAt, cutoff))));
  let sent = 0;
  for (const { req, caption } of open) {
    const ids = await notifyWorkspace(db, req.organizationId, req.workspaceId, ["APPROVER", "CLIENT_REVIEWER", "MANAGER", "AGENCY_OWNER", "AGENCY_ADMIN"], {
      kind: "approval_reminder",
      title: "Freigabe ausstehend",
      body: caption.slice(0, 160),
      link: `/app/posts/${req.postId}`,
    });
    if (mailer?.configured && ids.length) {
      const users = await db.select({ email: schema.users.email, locale: schema.users.locale, prefs: schema.users.notificationPrefs }).from(schema.users).where(inArray(schema.users.id, ids));
      for (const u of users.filter((x) => x.prefs.approvalEmails !== false))
        await mailer.send({ to: u.email, ...mailTemplates.approvalPending(u.locale, caption.length > 300 ? `${caption.slice(0, 300)}…` : caption, `${appUrl}/app/posts/${req.postId}`) });
    }
    await db.update(schema.approvalRequests).set({ remindedAt: now }).where(eq(schema.approvalRequests.id, req.id));
    sent++;
  }
  return sent;
}

