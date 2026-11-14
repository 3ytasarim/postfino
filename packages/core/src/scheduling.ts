import { and, asc, eq, gt, inArray, isNull, schema, type Db } from "@sichttakt/db";
import { AppError, NonexistentLocalTimeError, utcToWallClock, wallClockToUtc, type PostStatus } from "@sichttakt/shared";
import { enqueue } from "./queue";
import { authorize, loadWorkspace } from "./tenancy";
import { getChannel } from "./channels";
import { getPost, postView, contentSnapshot } from "./posts";
import { audit } from "./audit";
import { sha256 } from "./crypto";
import { stableStringify } from "./util";
import type { Actor } from "./rbac";

// Calendar & queue. Rules:
// - slots are local wall-clock per channel (weekday 1=Mon…7=Sun, minute of day) → converted to UTC per week,
//   so 09:00 stays 09:00 across DST; slot times inside the spring-forward gap are skipped
// - moving a post never changes its content version (approval stays valid)
// - every (re)schedule enqueues a new job with a time-specific dedup key; stale jobs no-op in the worker

const ACTIVE_TARGET: PostStatus[] = ["SCHEDULED", "PENDING_APPROVAL", "APPROVED", "PUBLISHING", "PREPARING_MEDIA"];
const MOVABLE_POST: PostStatus[] = ["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "FAILED_RETRYABLE"];
const MIN_LEAD_MS = 60_000;

export type Slot = { weekday: number; minuteOfDay: number };

export async function listSlots(db: Db, actor: Actor, channelId: string) {
  await getChannel(db, actor, channelId);
  const rows = await db.select().from(schema.scheduledSlots).where(eq(schema.scheduledSlots.channelId, channelId)).orderBy(asc(schema.scheduledSlots.weekday), asc(schema.scheduledSlots.minuteOfDay));
  return rows.map((r) => ({ weekday: r.weekday, minuteOfDay: r.minuteOfDay }));
}

export async function setSlots(db: Db, actor: Actor, channelId: string, slots: Slot[]) {
  const ch = await getChannel(db, actor, channelId);
  authorize(actor, ch.workspaceId, "posts.publish");
  for (const s of slots)
    if (!Number.isInteger(s.weekday) || s.weekday < 1 || s.weekday > 7 || !Number.isInteger(s.minuteOfDay) || s.minuteOfDay < 0 || s.minuteOfDay >= 1440)
      throw new AppError("VALIDATION_FAILED", "Invalid slot");
  const uniq = [...new Map(slots.map((s) => [`${s.weekday}:${s.minuteOfDay}`, s])).values()];
  if (uniq.length > 200) throw new AppError("VALIDATION_FAILED", "Too many slots");
  await db.transaction(async (tx) => {
    await tx.delete(schema.scheduledSlots).where(eq(schema.scheduledSlots.channelId, channelId));
    if (uniq.length) await tx.insert(schema.scheduledSlots).values(uniq.map((s) => ({ organizationId: ch.organizationId, channelId, weekday: s.weekday, minuteOfDay: s.minuteOfDay })));
  });
  await audit(db, { organizationId: ch.organizationId, workspaceId: ch.workspaceId, actor, action: "queue.slots_updated", targetType: "channel", targetId: channelId, metadata: { count: uniq.length } });
  return uniq;
}

/** ISO weekday (1=Mon) of a wall-clock date. */
const isoWeekday = (y: number, m: number, d: number) => ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;

/** Upcoming slot instants (UTC, ascending) for a channel after `after`, within `days`. */
export function expandSlots(slots: Slot[], timeZone: string, after: Date, days = 28): Date[] {
  if (slots.length === 0) return [];
  const start = utcToWallClock(after, timeZone);
  const out: Date[] = [];
  for (let i = 0; i <= days; i++) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const wd = isoWeekday(y, m, d);
    for (const s of slots.filter((x) => x.weekday === wd).sort((a, b) => a.minuteOfDay - b.minuteOfDay)) {
      try {
        const at = wallClockToUtc({ year: y, month: m, day: d, hour: Math.floor(s.minuteOfDay / 60), minute: s.minuteOfDay % 60 }, timeZone);
        if (at.getTime() > after.getTime()) out.push(at);
      } catch (e) {
        if (!(e instanceof NonexistentLocalTimeError)) throw e; // DST gap → slot does not exist that day
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** Next slot of the channel not occupied by another active target. */
export async function nextFreeSlot(db: Db, channelId: string, opts: { now?: Date; excludeTargetId?: string } = {}): Promise<Date> {
  const now = opts.now ?? new Date();
  const [ch] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId));
  if (!ch) throw new AppError("NOT_FOUND", "Account not found");
  const slots = await db.select().from(schema.scheduledSlots).where(eq(schema.scheduledSlots.channelId, channelId));
  const candidates = expandSlots(slots, ch.timezone, new Date(now.getTime() + MIN_LEAD_MS));
  if (candidates.length === 0) throw new AppError("VALIDATION_FAILED", "no_queue_slots: this account has no posting slots configured", { account_id: channelId });
  const busy = await db
    .select({ id: schema.postTargets.id, at: schema.postTargets.scheduledAt })
    .from(schema.postTargets)
    .where(and(eq(schema.postTargets.channelId, channelId), inArray(schema.postTargets.status, ACTIVE_TARGET), gt(schema.postTargets.scheduledAt, now)));
  const taken = new Set(busy.filter((b) => b.id !== opts.excludeTargetId && b.at).map((b) => b.at!.getTime()));
  const free = candidates.find((c) => !taken.has(c.getTime()));
  if (!free) throw new AppError("VALIDATION_FAILED", "queue_full: all slots in the next 4 weeks are taken", { account_id: channelId });
  return free;
}

async function enqueueTarget(db: Db, post: typeof schema.posts.$inferSelect, target: typeof schema.postTargets.$inferSelect) {
  if (target.status !== "SCHEDULED" || !target.scheduledAt) return;
  await enqueue(db, {
    kind: "publish_target",
    organizationId: post.organizationId,
    payload: { postTargetId: target.id, version: post.currentVersion },
    dedupKey: `publish:${target.id}:v${post.currentVersion}:${target.scheduledAt.toISOString()}`,
    runAt: target.scheduledAt,
    maxAttempts: 6,
  });
}

async function syncPostTime(db: Db, postId: string) {
  const ts = await db.select({ at: schema.postTargets.scheduledAt }).from(schema.postTargets).where(eq(schema.postTargets.postId, postId));
  const times = ts.map((t) => t.at?.getTime()).filter((x): x is number => typeof x === "number");
  await db.update(schema.posts).set({ scheduledAt: times.length ? new Date(Math.min(...times)) : null, updatedAt: new Date() }).where(eq(schema.posts.id, postId));
}

/** Calendar drag & drop: moves all not-yet-published targets of a post to `at`. */
export async function reschedulePost(db: Db, actor: Actor, postId: string, at: Date, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const { post } = await getPost(db, actor, postId);
  authorize(actor, post.workspaceId, "posts.write");
  if (!MOVABLE_POST.includes(post.status)) throw new AppError("INVALID_STATE_TRANSITION", `Cannot reschedule a post in status ${post.status}`);
  if (Number.isNaN(at.getTime()) || at.getTime() < now.getTime() + MIN_LEAD_MS) throw new AppError("VALIDATION_FAILED", "New time must be at least 1 minute in the future");
  const moved = await db
    .update(schema.postTargets)
    .set({ scheduledAt: at, updatedAt: now })
    .where(and(eq(schema.postTargets.postId, post.id), inArray(schema.postTargets.status, ["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "FAILED_RETRYABLE"])))
    .returning();
  const statusNext = post.status === "FAILED_RETRYABLE" ? "SCHEDULED" : post.status;
  await db.update(schema.posts).set({ scheduledAt: at, status: statusNext, updatedAt: now }).where(eq(schema.posts.id, post.id));
  if (post.status === "FAILED_RETRYABLE")
    await db.update(schema.postTargets).set({ status: "SCHEDULED" }).where(and(eq(schema.postTargets.postId, post.id), eq(schema.postTargets.status, "FAILED_RETRYABLE")));
  const fresh = await getPost(db, actor, post.id);
  for (const t of fresh.targets) await enqueueTarget(db, fresh.post, t);
  await audit(db, { organizationId: post.organizationId, workspaceId: post.workspaceId, actor, action: "post.rescheduled", targetType: "post", targetId: post.id, metadata: { from: post.scheduledAt?.toISOString() ?? null, to: at.toISOString(), targets: moved.length } });
  return postView(fresh.post, fresh.targets);
}

/** Bulk shift (e.g. "move all selected by +1 day"). Validates every post first; all-or-nothing on validation. */
export async function bulkShift(db: Db, actor: Actor, postIds: string[], deltaMinutes: number, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  if (postIds.length === 0 || postIds.length > 200) throw new AppError("VALIDATION_FAILED", "Select 1–200 posts");
  const plans: { id: string; at: Date }[] = [];
  for (const id of new Set(postIds)) {
    const { post } = await getPost(db, actor, id);
    if (!post.scheduledAt) throw new AppError("VALIDATION_FAILED", `Post ${id} has no time to shift`);
    const at = new Date(post.scheduledAt.getTime() + deltaMinutes * 60_000);
    if (!MOVABLE_POST.includes(post.status)) throw new AppError("INVALID_STATE_TRANSITION", `Post ${id} is ${post.status}`);
    if (at.getTime() < now.getTime() + MIN_LEAD_MS) throw new AppError("VALIDATION_FAILED", `Post ${id} would move into the past`);
    plans.push({ id, at });
  }
  const out = [];
  for (const p of plans) out.push(await reschedulePost(db, actor, p.id, p.at, { now }));
  return out;
}

/** "Add to queue": assigns each target of a post the next free slot of its own channel. */
export async function assignQueueSlots(db: Db, actor: Actor, postId: string, opts: { now?: Date } = {}) {
  const { post, targets } = await getPost(db, actor, postId);
  authorize(actor, post.workspaceId, "posts.write");
  if (!MOVABLE_POST.includes(post.status)) throw new AppError("INVALID_STATE_TRANSITION", `Cannot queue a post in status ${post.status}`);
  for (const t of targets) {
    const at = await nextFreeSlot(db, t.channelId, { now: opts.now, excludeTargetId: t.id });
    await db.update(schema.postTargets).set({ scheduledAt: at, updatedAt: new Date() }).where(eq(schema.postTargets.id, t.id));
  }
  await syncPostTime(db, post.id);
  const fresh = await getPost(db, actor, post.id);
  for (const t of fresh.targets) await enqueueTarget(db, fresh.post, t);
  return postView(fresh.post, fresh.targets);
}

/** Randomly permutes the times of the channel's queued (future, scheduled) targets. */
export async function shuffleQueue(db: Db, actor: Actor, channelId: string, opts: { now?: Date; random?: () => number } = {}) {
  const ch = await getChannel(db, actor, channelId);
  authorize(actor, ch.workspaceId, "posts.write");
  const now = opts.now ?? new Date();
  const rows = await db
    .select({ t: schema.postTargets, p: schema.posts })
    .from(schema.postTargets)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.postTargets.postId))
    .where(and(eq(schema.postTargets.channelId, channelId), eq(schema.postTargets.status, "SCHEDULED"), gt(schema.postTargets.scheduledAt, new Date(now.getTime() + MIN_LEAD_MS))));
  if (rows.length < 2) return 0;
  const times = rows.map((r) => r.t.scheduledAt!);
  const rnd = opts.random ?? Math.random;
  for (let i = times.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [times[i], times[j]] = [times[j]!, times[i]!];
  }
  for (let i = 0; i < rows.length; i++) {
    const [t] = await db.update(schema.postTargets).set({ scheduledAt: times[i]!, updatedAt: now }).where(eq(schema.postTargets.id, rows[i]!.t.id)).returning();
    await syncPostTime(db, rows[i]!.p.id);
    await enqueueTarget(db, rows[i]!.p, t!);
  }
  await audit(db, { organizationId: ch.organizationId, workspaceId: ch.workspaceId, actor, action: "queue.shuffled", targetType: "channel", targetId: channelId, metadata: { count: rows.length } });
  return rows.length;
}

export async function setQueuePaused(db: Db, actor: Actor, workspaceId: string, paused: boolean) {
  const ws = await loadWorkspace(db, actor, workspaceId, "posts.publish");
  await db.update(schema.workspaces).set({ queuePaused: paused, updatedAt: new Date() }).where(eq(schema.workspaces.id, ws.id));
  await audit(db, { organizationId: ws.organizationId, workspaceId: ws.id, actor, action: paused ? "queue.paused" : "queue.resumed" });
}

/** Duplicate / re-share: new DRAFT with the same content, media and active channels; no schedule. */
export async function clonePost(db: Db, actor: Actor, postId: string) {
  const { post, targets, media } = await getPost(db, actor, postId);
  authorize(actor, post.workspaceId, "posts.write");
  const activeChannels = await db
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .where(and(inArray(schema.channels.id, targets.map((t) => t.channelId).concat("00000000-0000-0000-0000-000000000000")), eq(schema.channels.status, "active"), isNull(schema.channels.disconnectedAt)));
  const keep = new Set(activeChannels.map((c) => c.id));
  const tgs = targets.filter((t) => keep.has(t.channelId));
  if (tgs.length === 0) throw new AppError("CHANNEL_NOT_ACTIVE", "None of the original accounts is still connected");
  const copy = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(schema.posts)
      .values({ organizationId: post.organizationId, workspaceId: post.workspaceId, type: post.type, status: "DRAFT", caption: post.caption, coverMode: post.coverMode, thumbOffsetMs: post.thumbOffsetMs, scheduledTimezone: post.scheduledTimezone, tags: post.tags, createdByUserId: actor.kind === "user" ? actor.userId : null, createdViaApiKeyId: actor.kind === "api_key" ? actor.apiKeyId : null })
      .returning();
    const newTargets = await tx
      .insert(schema.postTargets)
      .values(tgs.map((t) => ({ organizationId: post.organizationId, postId: p!.id, channelId: t.channelId, status: "DRAFT" as const, publishMode: t.publishMode, captionOverride: t.captionOverride, options: t.options })))
      .returning();
    if (media.length) await tx.insert(schema.postMedia).values(media.map((m) => ({ postId: p!.id, assetId: m.assetId, organizationId: m.organizationId, role: m.role, position: m.position })));
    const ids = (role: string) => media.filter((m) => m.role === role).sort((a, b) => a.position - b.position).map((m) => m.assetId);
    const snap = contentSnapshot(p!, { item: ids("item"), video: ids("video"), cover: ids("cover") }, newTargets);
    await tx.insert(schema.postVersions).values({ organizationId: post.organizationId, postId: p!.id, version: 1, snapshot: snap, contentHash: sha256(stableStringify(snap)), changedByUserId: actor.kind === "user" ? actor.userId : null });
    return { p: p!, newTargets };
  });
  await audit(db, { organizationId: post.organizationId, workspaceId: post.workspaceId, actor, action: "post.cloned", targetType: "post", targetId: copy.p.id, metadata: { from: post.id } });
  return postView(copy.p, copy.newTargets);
}
