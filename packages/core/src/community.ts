import { and, asc, desc, eq, gte, inArray, isNull, or, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import { AUTOMATIC_STATES } from "@sichttakt/social-adapters";
import { getChannelAuthForPublish, effectiveCapability, type AdapterRegistry } from "./channels";
import { authorize, loadWorkspace } from "./tenancy";
import { createIdea } from "./ideas";
import { enqueue } from "./queue";
import { audit } from "./audit";
import type { Keyring } from "./crypto";
import type { Actor } from "./rbac";

// Community: comments of our own published posts, per platform capability. No "universal
// inbox" illusion — accounts whose platform does not expose comments are listed as not supported.

type Deps = { db: Db; ring: Keyring; registry: AdapterRegistry };

export async function syncComments(deps: Deps, publishedPostId: string, now = new Date()) {
  const { db } = deps;
  const [pp] = await db.select().from(schema.publishedPosts).where(eq(schema.publishedPosts.id, publishedPostId));
  if (!pp) return { skipped: "not_found" };
  const state = await effectiveCapability(db, pp.platform, pp.channelId, "community.comments_read");
  if (!AUTOMATIC_STATES.includes(state)) return { skipped: `capability_${state}` };
  const { channel, auth } = await getChannelAuthForPublish(db, deps.ring, pp.channelId);
  const list = await deps.registry.get(channel.platform).listComments(auth, pp.externalPostId);
  const [post] = await db
    .select({ caption: schema.posts.caption })
    .from(schema.postTargets)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.postTargets.postId))
    .where(eq(schema.postTargets.id, pp.postTargetId));
  const threadValues = { organizationId: pp.organizationId, workspaceId: pp.workspaceId, channelId: pp.channelId, externalPostId: pp.externalPostId, publishedPostId: pp.id, postPermalink: pp.permalink, postCaption: post?.caption.slice(0, 300) ?? null, lastSyncedAt: now };
  const [thread] = await db
    .insert(schema.commentThreads)
    .values(threadValues)
    .onConflictDoUpdate({ target: [schema.commentThreads.channelId, schema.commentThreads.externalPostId], set: { lastSyncedAt: now, postPermalink: pp.permalink } })
    .returning();
  let added = 0;
  for (const c of list) {
    const isOwn = Boolean(channel.username && c.username && c.username.toLowerCase() === channel.username.toLowerCase());
    const rows = await db
      .insert(schema.comments)
      .values({ organizationId: pp.organizationId, threadId: thread!.id, externalCommentId: c.id, parentExternalId: c.parentId ?? null, authorName: c.username ?? null, body: c.text.slice(0, 5000), isOwn, postedAt: new Date(c.timestamp) })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) added++;
  }
  const latest = list.map((c) => new Date(c.timestamp).getTime()).sort((a, b) => b - a)[0];
  if (latest) await db.update(schema.commentThreads).set({ lastCommentAt: new Date(latest), ...(added ? { status: "open" } : {}) }).where(eq(schema.commentThreads.id, thread!.id));
  return { added, total: list.length };
}

export async function scheduleCommentSync(db: Db, now = new Date()) {
  const since = new Date(now.getTime() - 14 * 864e5);
  const pubs = await db.select({ id: schema.publishedPosts.id, org: schema.publishedPosts.organizationId }).from(schema.publishedPosts).where(gte(schema.publishedPosts.publishedAt, since));
  const slot = Math.floor(now.getTime() / 1_800_000);
  for (const p of pubs) await enqueue(db, { kind: "sync_comments", organizationId: p.org, payload: { publishedPostId: p.id }, dedupKey: `cm:${p.id}:${slot}`, maxAttempts: 2 });
  return pubs.length;
}

export type ThreadFilter = "unanswered" | "open" | "resolved" | "all";

export async function listThreads(db: Db, actor: Actor, p: { workspaceId: string; filter?: ThreadFilter; sort?: "newest" | "oldest"; channelId?: string }) {
  await loadWorkspace(db, actor, p.workspaceId, "analytics.read");
  const threads = await db
    .select({ t: schema.commentThreads, channel: schema.channels.displayName, platform: schema.channels.platform })
    .from(schema.commentThreads)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.commentThreads.channelId))
    .where(and(eq(schema.commentThreads.workspaceId, p.workspaceId), eq(schema.commentThreads.organizationId, actor.organizationId), p.channelId ? eq(schema.commentThreads.channelId, p.channelId) : undefined));
  const ids = threads.map((x) => x.t.id);
  const comments = ids.length ? await db.select().from(schema.comments).where(and(inArray(schema.comments.threadId, ids), isNull(schema.comments.hiddenAt))) : [];
  const rows = threads.map(({ t, channel, platform }) => {
    const cs = comments.filter((c) => c.threadId === t.id);
    const unanswered = cs.filter((c) => !c.isOwn && !c.repliedAt && !cs.some((o) => o.isOwn && o.parentExternalId === c.externalCommentId));
    return { ...t, channel, platform, commentCount: cs.length, unansweredCount: unanswered.length, lastCustomerAt: cs.filter((c) => !c.isOwn).map((c) => c.postedAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null };
  });
  const filter = p.filter ?? "unanswered";
  const out = rows.filter((r) => (filter === "unanswered" ? r.unansweredCount > 0 && r.status === "open" : filter === "open" ? r.status === "open" : filter === "resolved" ? r.status === "resolved" : true));
  const key = (r: (typeof rows)[number]) => (r.lastCustomerAt ?? r.createdAt).getTime();
  return out.sort((a, b) => (p.sort === "oldest" ? key(a) - key(b) : key(b) - key(a)));
}

async function loadThread(db: Db, actor: Actor, threadId: string) {
  const [t] = await db.select().from(schema.commentThreads).where(and(eq(schema.commentThreads.id, threadId), eq(schema.commentThreads.organizationId, actor.organizationId)));
  if (!t) throw new AppError("NOT_FOUND", "Thread not found");
  authorize(actor, t.workspaceId, "analytics.read");
  return t;
}

export async function getThread(db: Db, actor: Actor, threadId: string) {
  const t = await loadThread(db, actor, threadId);
  const comments = await db.select().from(schema.comments).where(eq(schema.comments.threadId, t.id)).orderBy(asc(schema.comments.postedAt));
  return { thread: t, comments };
}

export async function replyToComment(deps: Deps, actor: Actor, commentId: string, text: string) {
  const { db } = deps;
  const body = text.trim();
  if (!body || body.length > 2200) throw new AppError("VALIDATION_FAILED", "Reply must be 1–2200 characters");
  const [row] = await db.select({ c: schema.comments, t: schema.commentThreads }).from(schema.comments).innerJoin(schema.commentThreads, eq(schema.commentThreads.id, schema.comments.threadId)).where(and(eq(schema.comments.id, commentId), eq(schema.comments.organizationId, actor.organizationId)));
  if (!row) throw new AppError("NOT_FOUND", "Comment not found");
  authorize(actor, row.t.workspaceId, "community.reply");
  const [ch] = await db.select().from(schema.channels).where(eq(schema.channels.id, row.t.channelId));
  const state = await effectiveCapability(db, ch!.platform, ch!.id, "community.comments_reply");
  if (!AUTOMATIC_STATES.includes(state)) throw new AppError("CAPABILITY_NOT_SUPPORTED", `Replying is "${state}" for ${ch!.platform}`, { state });
  const { auth } = await getChannelAuthForPublish(db, deps.ring, ch!.id);
  // Instagram/Facebook replies attach to the top-level comment.
  const target = row.c.parentExternalId ?? row.c.externalCommentId;
  const r = await deps.registry.get(ch!.platform).replyComment(auth, target, body);
  const now = new Date();
  const [own] = await db
    .insert(schema.comments)
    .values({ organizationId: row.t.organizationId, threadId: row.t.id, externalCommentId: r.id, parentExternalId: target, authorName: ch!.username ?? ch!.displayName, body, isOwn: true, authoredByUserId: actor.kind === "user" ? actor.userId : null, postedAt: now })
    .returning();
  await db.update(schema.comments).set({ repliedAt: now }).where(eq(schema.comments.id, row.c.id));
  await audit(db, { organizationId: row.t.organizationId, workspaceId: row.t.workspaceId, actor, action: "community.replied", targetType: "comment", targetId: row.c.id });
  return own!;
}

export async function setThreadStatus(db: Db, actor: Actor, threadId: string, status: "open" | "resolved") {
  const t = await loadThread(db, actor, threadId);
  authorize(actor, t.workspaceId, "community.reply");
  await db.update(schema.commentThreads).set({ status }).where(eq(schema.commentThreads.id, t.id));
  await audit(db, { organizationId: t.organizationId, workspaceId: t.workspaceId, actor, action: `community.thread_${status}`, targetType: "comment_thread", targetId: t.id });
}

export async function assignThread(db: Db, actor: Actor, threadId: string, userId: string | null) {
  const t = await loadThread(db, actor, threadId);
  authorize(actor, t.workspaceId, "community.reply");
  if (userId) {
    const [m] = await db
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.organizationId, t.organizationId), eq(schema.memberships.userId, userId), or(isNull(schema.memberships.workspaceId), eq(schema.memberships.workspaceId, t.workspaceId))));
    if (!m) throw new AppError("NOT_FOUND", "User is not a member of this workspace");
  }
  await db.update(schema.commentThreads).set({ assignedUserId: userId }).where(eq(schema.commentThreads.id, t.id));
  if (userId) await db.insert(schema.notifications).values({ organizationId: t.organizationId, workspaceId: t.workspaceId, userId, kind: "thread_assigned", title: "Kommentar-Thread zugewiesen", link: `/app/community?thread=${t.id}` });
}

export async function commentToIdea(db: Db, actor: Actor, commentId: string) {
  const [row] = await db.select({ c: schema.comments, t: schema.commentThreads }).from(schema.comments).innerJoin(schema.commentThreads, eq(schema.commentThreads.id, schema.comments.threadId)).where(and(eq(schema.comments.id, commentId), eq(schema.comments.organizationId, actor.organizationId)));
  if (!row) throw new AppError("NOT_FOUND", "Comment not found");
  return createIdea(db, actor, { workspaceId: row.t.workspaceId, title: `Aus Kommentar: ${row.c.body.slice(0, 80)}`, body: `${row.c.authorName ? `@${row.c.authorName}: ` : ""}${row.c.body}`, links: row.t.postPermalink ? [row.t.postPermalink] : [], source: "comment", sourceRef: row.c.externalCommentId });
}

// ── Saved replies ──
export async function listSavedReplies(db: Db, actor: Actor, workspaceId: string) {
  await loadWorkspace(db, actor, workspaceId, "analytics.read");
  return db.select().from(schema.savedReplies).where(eq(schema.savedReplies.workspaceId, workspaceId)).orderBy(asc(schema.savedReplies.title));
}
export async function saveSavedReply(db: Db, actor: Actor, workspaceId: string, p: { title: string; body: string }) {
  await loadWorkspace(db, actor, workspaceId, "community.reply");
  if (!p.title.trim() || !p.body.trim() || p.body.length > 1000) throw new AppError("VALIDATION_FAILED", "Title and body (max 1000) required");
  const [r] = await db.insert(schema.savedReplies).values({ organizationId: actor.organizationId, workspaceId, title: p.title.trim().slice(0, 100), body: p.body }).returning();
  return r!;
}
export async function deleteSavedReply(db: Db, actor: Actor, id: string) {
  const [r] = await db.select().from(schema.savedReplies).where(and(eq(schema.savedReplies.id, id), eq(schema.savedReplies.organizationId, actor.organizationId)));
  if (!r) throw new AppError("NOT_FOUND", "Saved reply not found");
  authorize(actor, r.workspaceId, "community.reply");
  await db.delete(schema.savedReplies).where(eq(schema.savedReplies.id, r.id));
}

/** Response-time and reply-rate statistics for comments received in the period. */
export async function communityStats(db: Db, actor: Actor, p: { workspaceId: string; from: Date; to: Date }) {
  await loadWorkspace(db, actor, p.workspaceId, "analytics.read");
  const rows = await db
    .select({ c: schema.comments })
    .from(schema.comments)
    .innerJoin(schema.commentThreads, eq(schema.commentThreads.id, schema.comments.threadId))
    .where(and(eq(schema.commentThreads.workspaceId, p.workspaceId), eq(schema.comments.organizationId, actor.organizationId), gte(schema.comments.postedAt, p.from)))
    .orderBy(desc(schema.comments.postedAt));
  const all = rows.map((r) => r.c).filter((c) => c.postedAt <= p.to);
  const incoming = all.filter((c) => !c.isOwn);
  const own = all.filter((c) => c.isOwn);
  const times = incoming
    .map((c) => own.find((o) => o.parentExternalId === (c.parentExternalId ?? c.externalCommentId) && o.postedAt >= c.postedAt))
    .map((o, i) => (o ? o.postedAt.getTime() - incoming[i]!.postedAt.getTime() : null))
    .filter((x): x is number => x !== null);
  return {
    received: incoming.length,
    replied: times.length,
    replyRate: incoming.length ? Math.round((times.length / incoming.length) * 100) : null,
    medianResponseMinutes: times.length ? Math.round([...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]! / 60_000) : null,
  };
}
