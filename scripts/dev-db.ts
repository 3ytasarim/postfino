// Local development PostgreSQL (embedded binaries, no Docker). Data lives in .data/pg (gitignored).
// Production uses a managed/self-hosted PostgreSQL on Hetzner — see docs/ARCHITECTURE.md.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".data/pg");
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "sichttakt", password: "sichttakt", port: 54347, persistent: true, initdbFlags: ["--locale=C", "--encoding=UTF8"] });
if (!existsSync(path.join(dataDir, "PG_VERSION"))) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("sichttakt");
} catch {
  /* exists */
}
console.log("[db] PostgreSQL on 127.0.0.1:54347 (db sichttakt) — Ctrl+C to stop");
const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
