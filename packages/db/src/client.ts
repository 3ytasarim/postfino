import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Driver-agnostic handle: postgres-js in apps, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export function createDb(url: string, opts: { max?: number } = {}): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, { max: opts.max ?? 10, prepare: false });
  const db = drizzlePg(client, { schema }) as unknown as Db;
  return { db, close: () => client.end() };
}
