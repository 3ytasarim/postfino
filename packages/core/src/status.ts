import { and, eq, lt, sql, schema, type Db } from "@sichttakt/db";
import { rowsOf } from "./util";

// Status page data: DB reachability, worker heartbeats, queue backlog. No tenant data is exposed.

export async function recordHeartbeat(db: Db, name: string, kind: string, meta: Record<string, unknown> = {}) {
  const now = new Date();
  await db.insert(schema.systemHeartbeats).values({ name, kind, lastSeenAt: now, meta }).onConflictDoUpdate({ target: schema.systemHeartbeats.name, set: { lastSeenAt: now, meta } });
}

export type SystemStatus = { db: boolean; workers: { name: string; lastSeenAt: Date; ok: boolean }[]; backlog: number | null; dead: number | null; overall: "operational" | "degraded" | "down" };

export async function systemStatus(db: Db, now = new Date()): Promise<SystemStatus> {
  try {
    await db.execute(sql`select 1`);
  } catch {
    return { db: false, workers: [], backlog: null, dead: null, overall: "down" };
  }
  const beats = await db.select().from(schema.systemHeartbeats).where(eq(schema.systemHeartbeats.kind, "worker"));
  const workers = beats.map((b) => ({ name: b.name.replace(/:.*/, ""), lastSeenAt: b.lastSeenAt, ok: now.getTime() - b.lastSeenAt.getTime() < 120_000 }));
  const overdue = new Date(now.getTime() - 5 * 60_000).toISOString();
  const dayAgo = new Date(now.getTime() - 864e5).toISOString();
  const [backlog] = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from queue_items where status = 'pending' and run_at < ${overdue}::timestamptz`));
  const [dead] = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from queue_items where status = 'dead' and updated_at > ${dayAgo}::timestamptz`));
  await db.delete(schema.systemHeartbeats).where(and(eq(schema.systemHeartbeats.kind, "worker"), lt(schema.systemHeartbeats.lastSeenAt, new Date(now.getTime() - 7 * 864e5))));
  const anyWorker = workers.some((w) => w.ok);
  const overall = !anyWorker || (backlog?.n ?? 0) > 50 ? "degraded" : "operational";
  return { db: true, workers, backlog: backlog?.n ?? 0, dead: dead?.n ?? 0, overall };
}
