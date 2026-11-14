import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, schema } from "@sichttakt/db";
import { createManualChannel, createPost, getPost, isPlatformConfigured, beginConnect } from "@sichttakt/core";
import { createTestServices, createTenant, inMinutes } from "./helpers";

let svc: Awaited<ReturnType<typeof createTestServices>>;
beforeAll(async () => {
  svc = await createTestServices();
});
afterAll(() => svc.close());

describe("reminder-only channels (no publishing API)", () => {
  it("are created by name without any network call and always publish in notification mode", async () => {
    const t = await createTenant(svc);
    expect(isPlatformConfigured(svc.config, "instagram_personal")).toBe(true);
    const ch = await createManualChannel(svc.db, svc.ring, t.actor, { workspaceId: t.workspace.id, platform: "instagram_personal", displayName: "Café privat", username: "@cafe.privat" });
    expect(ch).toMatchObject({ platform: "instagram_personal", display_name: "Café privat", username: "cafe.privat", granted_scopes: ["notification"] });
    await expect(createManualChannel(svc.db, svc.ring, t.actor, { workspaceId: t.workspace.id, platform: "tiktok", displayName: "x" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(createManualChannel(svc.db, svc.ring, t.actor, { workspaceId: t.workspace.id, platform: "substack", displayName: "  " })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(beginConnect(svc.db, svc.registry, t.actor, { workspaceId: t.workspace.id, platform: "instagram_personal", redirectUri: "http://x/cb" })).rejects.toBeTruthy();

    // even when "automatic" is requested, the target is forced to notification mode
    const { post } = await createPost(svc.db, svc.registry, t.actor, { workspace_id: t.workspace.id, account_ids: [ch.id], type: "image", caption: "Hallo", media_asset_ids: [], status: "scheduled", scheduled_at: inMinutes(30).toISOString(), publish_mode: "automatic" } as never).catch(async () =>
      createPost(svc.db, svc.registry, t.actor, { workspace_id: t.workspace.id, account_ids: [ch.id], type: "text", caption: "Hallo", media_asset_ids: [], status: "scheduled", scheduled_at: inMinutes(30).toISOString(), publish_mode: "automatic" } as never),
    );
    const target = (await getPost(svc.db, t.actor, post.id)).targets[0]!;
    expect(target.publishMode).toBe("notification");
    const [cred] = await svc.db.select().from(schema.channelCredentials).where(eq(schema.channelCredentials.channelId, ch.id));
    expect(cred).toBeTruthy();
  });
});
