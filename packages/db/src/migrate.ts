import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getConfig } from "@sichttakt/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const url = getConfig().DATABASE_URL;
const client = postgres(url, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: path.join(here, "..", "drizzle") });
await client.end();
console.log("migrations applied");
