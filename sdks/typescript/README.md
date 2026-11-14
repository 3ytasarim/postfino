# @sichttakt/sdk (TypeScript / JavaScript)

Zero dependencies (global `fetch` + Web Crypto). Node 18+, Deno, Bun, edge runtimes. Server-side only.

```ts
import { SichtTakt, SichtTaktError, verifyWebhook } from "@sichttakt/sdk";

const st = new SichtTakt({ apiKey: process.env.SICHTTAKT_API_KEY! });
const [ws] = (await st.workspaces.list()).data;
const [account] = (await st.accounts.list(ws.id)).data as { id: string }[];

const img = await st.media.upload({ workspace_id: ws.id, filename: "herbst.jpg", mime_type: "image/jpeg", data: await fs.readFile("herbst.jpg") });
await st.posts.create(
  { workspace_id: ws.id, account_ids: [account.id], type: "image", caption: "Die Herbst-Kollektion ist da", media_asset_ids: [img.id], scheduled_at: "2026-11-12T10:00:00+01:00", status: "scheduled" },
  "cms-entry-42-rev-3", // stable Idempotency-Key → safe retries
);

const { short_url } = await st.links.create({ workspace_id: ws.id, url: "https://shop.example.de/herbst" });
```

Errors throw `SichtTaktError` (`status`, `code`, `details`, `requestId`, `retryAfter`). 429 / 5xx are retried (default 2×) with the same key.

## Webhooks

```ts
const ok = await verifyWebhook(process.env.SICHTTAKT_WEBHOOK_SECRET!, rawBody, req.headers.get("sichttakt-signature"));
```

Use the raw body, not re-serialised JSON. Signatures older than 5 minutes are rejected.
