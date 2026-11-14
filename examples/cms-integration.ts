/**
 * Example third-party integration (e.g. a customer's CMS backend) — server-side only.
 * Flow: upload video + independent cover → schedule Reel → receive signed webhooks.
 *
 *   SICHTTAKT_API_KEY=st_live_… SICHTTAKT_API=http://localhost:3611 npx tsx examples/cms-integration.ts
 *
 * Only targets the accounts the key may see; with a sandbox account nothing is posted to a real network.
 */
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const API = process.env.SICHTTAKT_API ?? "http://localhost:3611";
const KEY = process.env.SICHTTAKT_API_KEY!;
const HOOK_PORT = Number(process.env.HOOK_PORT ?? 3699);
let webhookSecret = "";
const received: { event: string; valid: boolean }[] = [];

function verify(body: string, header: string) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = createHmac("sha256", webhookSecret).update(`${parts.t}.${body}`).digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 ?? ""));
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const valid = verify(body, String(req.headers["sichttakt-signature"] ?? ""));
    received.push({ event: String(req.headers["sichttakt-event"]), valid });
    console.log(`  ← webhook ${req.headers["sichttakt-event"]} signature=${valid ? "valid" : "INVALID"}`);
    res.writeHead(valid ? 200 : 400).end();
  });
}).listen(HOOK_PORT);

async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${KEY}`, ...(body && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : {}), ...(method !== "GET" ? { "idempotency-key": crypto.randomUUID() } : {}), ...extra },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
  });
  const json = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function upload(workspace: string, file: string, mime: string, purpose: string) {
  const data = new Uint8Array(readFileSync(file));
  const a = await call("POST", "/api/v1/media/uploads", { workspace_id: workspace, filename: file.split(/[\/]/).pop(), mime_type: mime, size_bytes: data.length, purpose });
  return (await call("PUT", `/api/v1/media/${a.id}/content`, data, { "content-type": mime })).id as string;
}

const [videoFile, coverFile] = process.argv.slice(2);
const ws = (await call("GET", "/api/v1/workspaces")).data[0];
const accounts = (await call("GET", `/api/v1/accounts?workspace_id=${ws.id}`)).data;
const account = accounts.find((a: { is_sandbox: boolean }) => a.is_sandbox) ?? accounts[0];
console.log(`workspace ${ws.name}, account ${account.display_name} (sandbox=${account.is_sandbox})`);
const hook = await call("POST", "/api/v1/webhooks", { url: `http://localhost:${HOOK_PORT}/hooks`, events: ["post.created", "post.scheduled", "post.published", "post.failed"] });
webhookSecret = hook.secret;
const video = await upload(ws.id, videoFile!, "video/mp4", "video");
const cover = await upload(ws.id, coverFile!, "image/jpeg", "cover");
const scheduledAt = new Date(Date.now() + 75_000).toISOString();
const post = await call("POST", "/api/v1/posts", { workspace_id: ws.id, account_ids: [account.id], type: "reel", caption: "Unser neuer Cocktail ist da! 🍹", video_asset_id: video, cover_asset_id: cover, scheduled_at: scheduledAt, status: "scheduled" });
console.log(`post ${post.id} status=${post.status} cover_mode=${post.cover_mode} scheduled_at=${post.scheduled_at}`);

const deadline = Date.now() + 4 * 60_000;
let last = post;
while (Date.now() < deadline && !["PUBLISHED", "FAILED_FINAL"].includes(last.status)) {
  await new Promise((r) => setTimeout(r, 5000));
  last = await call("GET", `/api/v1/posts/${post.id}`);
}
await new Promise((r) => setTimeout(r, 6000));
console.log(`final status=${last.status} permalink=${last.targets[0]?.permalink}`);
console.log(`webhooks: ${received.map((r) => `${r.event}(${r.valid ? "ok" : "bad"})`).join(", ")}`);
await call("DELETE", `/api/v1/webhooks/${hook.id}`);
server.close();
