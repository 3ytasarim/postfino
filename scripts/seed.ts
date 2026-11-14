// Development/staging seed. Creates one demo agency with a SANDBOX channel only (clearly labelled MOCK).
// Never run against production (guard below).
import path from "node:path";
import { eq, schema } from "@sichttakt/db";
import { createServices, seedReferenceData, registerUser, createOrganization, upsertChannel } from "@sichttakt/core";

const svc = createServices({ root: path.resolve(".") });
if (svc.config.NODE_ENV === "production") throw new Error("seed refuses to run in production");
await seedReferenceData(svc.db);
const email = process.env.SEED_EMAIL ?? "demo@sichttakt.local";
const password = process.env.SEED_PASSWORD ?? "SichtTakt-Demo-2026";
const [existing] = await svc.db.select().from(schema.users).where(eq(schema.users.email, email));
if (existing) {
  console.log(`seed: ${email} exists, nothing to do`);
} else {
  const user = await registerUser(svc.db, { email, name: "Demo Agentur", password });
  const { organization, workspace } = await createOrganization(svc.db, { ownerUserId: user.id, name: "Demo Agentur GmbH", workspaceName: "Café Morgenrot", plan: "agency" });
  await svc.db.update(schema.subscriptions).set({ status: "active" }).where(eq(schema.subscriptions.organizationId, organization.id));
  await upsertChannel(svc.db, svc.ring, {
    organizationId: organization.id,
    workspaceId: workspace.id,
    platform: "sandbox",
    isSandbox: true,
    userId: user.id,
    account: { externalId: "sandbox-demo", displayName: "Sandbox Instagram (MOCK)", username: "cafe.morgenrot.sandbox", accessToken: "sandbox-token", grantedScopes: ["sandbox"], meta: { mock: true } },
  });
  console.log(`seed: created ${email} (password in SEED_PASSWORD or the documented dev default)`);
}
await svc.close();
