import { eq, sql, schema, type Db } from "@sichttakt/db";
import { rowsOf } from "./util";

// Durable Postgres job queue.
// - enqueue is idempotent via dedup_key (ON CONFLICT DO NOTHING)
// - claim uses FOR UPDATE SKIP LOCKED + a lease (locked_until) → crashed workers' jobs are recovered
// - failures back off exponentially with jitter; after max_attempts the job is "dead" (DLQ) and can be replayed

export type JobKind = "publish_target" | "deliver_webhook" | "refresh_token" | "fetch_rss" | "approval_reminder" | "collect_insights" | "sync_comments" | "generate_report";
export type Job = typeof schema.queueItems.$inferSelect;

export async function enqueue(
  db: Db,
  p: { kind: JobKind; payload: Record<string, unknown>; organizationId?: string; dedupKey?: string; runAt?: Date; maxAttempts?: number },
): Promise<{ id: string | null; deduplicated: boolean }> {
  const rows = await db
    .insert(schema.queueItems)
    .values({
      kind: p.kind,
      payload: p.payload,
      organizationId: p.organizationId,
      dedupKey: p.dedupKey,
      runAt: p.runAt ?? new Date(),
      maxAttempts: p.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: schema.queueItems.dedupKey })
    .returning({ id: schema.queueItems.id });
  return rows[0] ? { id: rows[0].id, deduplicated: false } : { id: null, deduplicated: true };
}

export async function claimJobs(db: Db, workerId: string, opts: { limit?: number; leaseSeconds?: number; kinds?: JobKind[]; now?: Date } = {}): Promise<Job[]> {
  const now = (opts.now ?? new Date()).toISOString();
  const lease = opts.leaseSeconds ?? 120;
  const kinds = opts.kinds ?? ["publish_target", "deliver_webhook", "refresh_token", "fetch_rss", "approval_reminder", "collect_insights", "sync_comments", "generate_report"];
  const res = await db.execute(sql`
    update queue_items q set status = 'running', locked_by = ${workerId},
      locked_until = ${now}::timestamptz + make_interval(secs => ${lease}),
      attempts = q.attempts + 1, updated_at = now()
    where q.id in (
      select id from queue_items
      where kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
        and ((status = 'pending' and run_at <= ${now}::timestamptz)
          or (status = 'running' and locked_until < ${now}::timestamptz))
      order by run_at
      limit ${opts.limit ?? 10}
      for update skip locked
    )
    returning q.id`);
  const ids = rowsOf<{ id: string }>(res).map((r) => r.id);
  if (ids.length === 0) return [];
  return db.select().from(schema.queueItems).where(sql`${schema.queueItems.id} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
}

export async function completeJob(db: Db, id: string) {
  await db.update(schema.queueItems).set({ status: "done", lockedBy: null, lockedUntil: null, updatedAt: new Date() }).where(eq(schema.queueItems.id, id));
}

export function backoffMs(attempt: number, baseMs = 15_000, capMs = 30 * 60_000, rand = Math.random): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + rand() * (exp / 2)); // "equal jitter"
}

export async function failJob(db: Db, job: Job, error: string, opts: { retryable: boolean; now?: Date }) {
  const now = opts.now ?? new Date();
  const dead = !opts.retryable || job.attempts >= job.maxAttempts;
  await db
    .update(schema.queueItems)
    .set({
      status: dead ? "dead" : "pending",
      runAt: dead ? job.runAt : new Date(now.getTime() + backoffMs(job.attempts)),
      lockedBy: null,
      lockedUntil: null,
      lastError: error.slice(0, 2000),
      updatedAt: now,
    })
    .where(eq(schema.queueItems.id, job.id));
  return { dead };
}

/** Manual replay from the dead-letter state (admin action). */
export async function replayDeadJob(db: Db, id: string) {
  await db
    .update(schema.queueItems)
    .set({ status: "pending", attempts: 0, runAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(sql`${schema.queueItems.id} = ${id} and ${schema.queueItems.status} = 'dead'`);
}
