import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiKey } from "@sichttakt/core";
import { createApiApp } from "@sichttakt/api";
import { createTestServices, createTenant, uploadAsset, inMinutes } from "./helpers";

let svc: Awaited<ReturnType<typeof createTestServices>>;
let app: ReturnType<typeof createApiApp>;
beforeAll(async () => {
  svc = await createTestServices();
  app = createApiApp(svc, { allowPrivateWebhookUrls: true });
});
afterAll(() => svc.close());

const call = (key: string, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(method !== "GET" ? { "idempotency-key": crypto.randomUUID() } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("public API: slots, queue, reschedule, clone", () => {
  it("external system configures slots, queues a post, moves it and duplicates it", async () => {
    const t = await createTenant(svc);
    const { secret } = await createApiKey(svc.db, t.actor, { name: "CMS", scopes: ["posts:read", "posts:write", "posts:publish", "calendar:read"], workspaceIds: [t.workspace.id] });
    const put = await call(secret, "PUT", `/api/v1/accounts/${t.channel.id}/slots`, { slots: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, minute_of_day: 600 })) });
    expect(put.status).toBe(200);
    const slots = (await (await call(secret, "GET", `/api/v1/accounts/${t.channel.id}/slots`)).json()) as { data: unknown[] };
    expect(slots.data).toHaveLength(7);

    const img = await uploadAsset(svc, t.actor, t.workspace.id, "image", { width: 1080, height: 1080 });
    const created = await call(secret, "POST", "/api/v1/posts", { workspace_id: t.workspace.id, account_ids: [t.channel.id], type: "image", caption: "Queue", media_asset_ids: [img.id], status: "scheduled", queue: true });
    expect(created.status).toBe(202);
    const post = (await created.json()) as { id: string; scheduled_at: string };
    expect(post.scheduled_at).toBeTruthy();

    const target = inMinutes(3 * 24 * 60).toISOString();
    const moved = await call(secret, "POST", `/api/v1/posts/${post.id}/reschedule`, { scheduled_at: target });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { scheduled_at: string }).scheduled_at).toBe(target);

    const cloned = await call(secret, "POST", `/api/v1/posts/${post.id}/clone`);
    expect(cloned.status).toBe(201);
    const c = (await cloned.json()) as { id: string; status: string; scheduled_at: string | null };
    expect(c.id).not.toBe(post.id);
    expect(c.status).toBe("DRAFT");
    expect(c.scheduled_at).toBeNull();
  });

  it("slot changes need posts:publish scope", async () => {
    const t = await createTenant(svc);
    const { secret } = await createApiKey(svc.db, t.actor, { name: "RO", scopes: ["calendar:read"], workspaceIds: [t.workspace.id] });
    expect((await call(secret, "PUT", `/api/v1/accounts/${t.channel.id}/slots`, { slots: [] })).status).toBe(403);
  });
});
