import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { schema, type Db } from "@sichttakt/db";
import { getConfig } from "@sichttakt/config";
import {
  AdapterRegistry,
  LocalStorageDriver,
  DevOutboxMailer,
  UnconfiguredAiProvider,
  parseKeyring,
  registerUser,
  createOrganization,
  buildUserActor,
  seedReferenceData,
  upsertChannel,
  createMediaAsset,
  storeMediaContent,
  type Actor,
  type Services,
} from "@sichttakt/core";
import { SandboxAdapter } from "@sichttakt/social-adapters";
import { eq } from "drizzle-orm";
import { jpeg, mp4 } from "./fixtures";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function createTestServices(): Promise<Services & { sandbox: SandboxAdapter; pg: PGlite; storage: LocalStorageDriver; mailer: DevOutboxMailer }> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema }) as unknown as Db;
  await migrate(drizzle(pg), { migrationsFolder: path.join(root, "packages/db/drizzle") });
  await seedReferenceData(db);
  const config = getConfig({ NODE_ENV: "test", API_URL: "http://localhost:3611", MEDIA_PUBLIC_BASE_URL: "https://media.test.invalid" } as NodeJS.ProcessEnv);
  const sandbox = new SandboxAdapter();
  const storage = new LocalStorageDriver(mkdtempSync(path.join(os.tmpdir(), "sichttakt-test-")), "test-secret", config.MEDIA_PUBLIC_BASE_URL);
  return {
    config,
    db,
    ring: parseKeyring(undefined, "test"),
    registry: new AdapterRegistry(config, { sandbox }),
    storage,
    mailer: new DevOutboxMailer(null, "test@sichttakt.invalid"),
    ai: new UnconfiguredAiProvider(),
    sandbox,
    pg,
    close: () => pg.close(),
  };
}

let seq = 0;
export async function createTenant(svc: Services, opts: { plan?: "starter" | "pro" | "agency" | "enterprise"; approvalRequired?: boolean } = {}) {
  seq++;
  const user = await registerUser(svc.db, { email: `owner${seq}-${Date.now()}@example.test`, name: `Owner ${seq}`, password: "Sicher-Passwort-123" });
  const { organization, workspace } = await createOrganization(svc.db, { ownerUserId: user.id, name: `Agentur ${seq}`, workspaceName: `Marke ${seq}`, plan: opts.plan ?? "pro" });
  if (opts.approvalRequired) await svc.db.update(schema.workspaces).set({ approvalRequired: true }).where(eq(schema.workspaces.id, workspace.id));
  await svc.db.update(schema.subscriptions).set({ status: "active" }).where(eq(schema.subscriptions.organizationId, organization.id));
  const actor = (await buildUserActor(svc.db, user.id, organization.id))!;
  const channel = await upsertChannel(svc.db, svc.ring, {
    organizationId: organization.id,
    workspaceId: workspace.id,
    platform: "sandbox",
    isSandbox: true,
    userId: user.id,
    account: { externalId: `sbx-${seq}`, displayName: "Sandbox IG", accessToken: "sandbox-token", grantedScopes: ["sandbox"], meta: {} },
  });
  return { user, organization, workspace, actor, channel };
}

export async function uploadAsset(svc: Services, actor: Actor, workspaceId: string, kind: "video" | "cover" | "image", opts: { durationMs?: number; width?: number; height?: number } = {}) {
  const data = kind === "video" ? mp4({ durationMs: opts.durationMs ?? 8000, width: opts.width ?? 1080, height: opts.height ?? 1920 }) : jpeg(opts.width ?? 1080, opts.height ?? 1920);
  const a = await createMediaAsset(svc.db, actor, {
    workspaceId,
    filename: kind === "video" ? "reel.mp4" : "cover.jpg",
    mimeType: kind === "video" ? "video/mp4" : "image/jpeg",
    sizeBytes: data.length,
    purpose: kind === "video" ? "video" : kind === "cover" ? "cover" : "image",
  });
  return storeMediaContent(svc.db, svc.storage, actor, a.id, data);
}

export const inMinutes = (m: number, from = new Date()) => new Date(from.getTime() + m * 60_000);
