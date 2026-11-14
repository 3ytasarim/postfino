import { serve } from "@hono/node-server";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServices, seedReferenceData } from "@sichttakt/core";
import { createApiApp } from "./app";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const svc = createServices({ root });
await seedReferenceData(svc.db);
const app = createApiApp(svc, { allowPrivateWebhookUrls: svc.config.NODE_ENV !== "production" });
const port = Number(new URL(svc.config.API_URL).port || 3611);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => console.log(`[api] listening on :${port}`));
