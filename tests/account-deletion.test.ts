import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sichttakt/db";
import { createPost, deleteOwnAccount, planAccountDeletion, registerUser } from "@sichttakt/core";
import { createTestServices, createTenant, uploadAsset } from "./helpers";

const PW = "Sicher-Passwort-123";
let svc: Awaited<ReturnType<typeof createTestServices>>;
beforeAll(async () => {
  svc = await createTestServices();
});
afterAll(() => svc.close());

const count = async (table: typeof schema.posts | typeof schema.mediaAssets | typeof schema.channels, orgId: string) =>
  (await svc.db.select().from(table).where(eq(table.organizationId, orgId))).length;

describe("self-service account deletion", () => {
  it("refuses without the correct password", async () => {
    const t = await createTenant(svc);
    await expect(deleteOwnAccount(svc, t.user.id, { password: "falsch" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(deleteOwnAccount(svc, t.user.id, {})).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const [u] = await svc.db.select().from(schema.users).where(eq(schema.users.id, t.user.id));
    expect(u).toBeDefined();
  });

  it("deletes a single-member organisation with posts, media files and channels; other tenants stay", async () => {
    const t = await createTenant(svc);
    const other = await createTenant(svc);
    const video = await uploadAsset(svc, t.actor, t.workspace.id, "video");
    const cover = await uploadAsset(svc, t.actor, t.workspace.id, "cover");
    await createPost(svc.db, svc.registry, t.actor, { workspace_id: t.workspace.id, account_ids: [t.channel.id], type: "reel", caption: "x", media_asset_ids: [], video_asset_id: video.id, cover_asset_id: cover.id, status: "draft", publish_mode: "automatic" });
    const otherAsset = await uploadAsset(svc, other.actor, other.workspace.id, "cover");

    const r = await deleteOwnAccount(svc, t.user.id, { password: PW });
    expect(r.deletedOrganizations).toBe(1);

    expect(await svc.db.select().from(schema.users).where(eq(schema.users.id, t.user.id))).toHaveLength(0);
    expect(await svc.db.select().from(schema.organizations).where(eq(schema.organizations.id, t.organization.id))).toHaveLength(0);
    expect(await count(schema.posts, t.organization.id)).toBe(0);
    expect(await count(schema.mediaAssets, t.organization.id)).toBe(0);
    expect(await count(schema.channels, t.organization.id)).toBe(0);
    expect(await svc.db.select().from(schema.sessions).where(eq(schema.sessions.userId, t.user.id))).toHaveLength(0);
    await expect(svc.storage.get(video.storageKey)).rejects.toBeTruthy();

    // untouched: the other tenant
    expect(await count(schema.channels, other.organization.id)).toBe(1);
    expect(await count(schema.mediaAssets, other.organization.id)).toBe(1);
    await expect(svc.storage.get(otherAsset.storageKey)).resolves.toBeTruthy();

    // the email address is free again
    await expect(registerUser(svc.db, { email: t.user.email, name: "Neu", password: PW })).resolves.toBeTruthy();
  });

  it("refuses while the user is the only owner of a team with other members; leaves teams that have another owner", async () => {
    const t = await createTenant(svc);
    const colleague = await registerUser(svc.db, { email: `kollege-${Date.now()}@example.test`, name: "Kollege", password: PW });
    await svc.db.insert(schema.memberships).values({ organizationId: t.organization.id, userId: colleague.id, role: "EDITOR", acceptedAt: new Date() });

    expect((await planAccountDeletion(svc.db, t.user.id)).blockedByOwnership.map((o) => o.id)).toEqual([t.organization.id]);
    await expect(deleteOwnAccount(svc, t.user.id, { password: PW })).rejects.toMatchObject({ code: "CONFLICT", message: "owner_has_members" });

    // the colleague (not an owner) can delete their account: the team and its data stay
    const r = await deleteOwnAccount(svc, colleague.id, { password: PW });
    expect(r).toMatchObject({ deletedOrganizations: 0, leftOrganizations: 1 });
    expect(await svc.db.select().from(schema.organizations).where(eq(schema.organizations.id, t.organization.id))).toHaveLength(1);
    expect(await count(schema.channels, t.organization.id)).toBe(1);
  });

  it("refuses while a paid subscription is running", async () => {
    const t = await createTenant(svc);
    await svc.db.update(schema.subscriptions).set({ status: "active", externalSubscriptionId: "sub_test_123" }).where(eq(schema.subscriptions.organizationId, t.organization.id));
    await expect(deleteOwnAccount(svc, t.user.id, { password: PW })).rejects.toMatchObject({ code: "CONFLICT", message: "active_subscription" });
    expect(await svc.db.select().from(schema.organizations).where(eq(schema.organizations.id, t.organization.id))).toHaveLength(1);
  });

  it("accounts without a password (Google/Apple sign-in) confirm with their email address", async () => {
    const t = await createTenant(svc);
    await svc.db.update(schema.users).set({ passwordHash: null }).where(eq(schema.users.id, t.user.id));
    await expect(deleteOwnAccount(svc, t.user.id, { email: "someone@else.test" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(deleteOwnAccount(svc, t.user.id, { email: ` ${t.user.email.toUpperCase()} ` })).resolves.toMatchObject({ deletedOrganizations: 1 });
  });
});
