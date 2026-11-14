import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { eq, schema } from "@sichttakt/db";
import {
  inviteMember,
  acceptInvite,
  getInvite,
  listMembers,
  changeMemberRole,
  removeMember,
  registerUser,
  buildUserActor,
  createPasswordReset,
  resetPassword,
  login,
  createEmailVerification,
  verifyEmail,
  S3StorageDriver,
  clamavScan,
  scheduleTokenRefreshes,
  processRefreshJob,
  claimJobs,
  AdapterRegistry,
  getChannelAuthForPublish,
  encrypt,
} from "@sichttakt/core";
import { ProviderError, SandboxAdapter, type PlatformAdapter } from "@sichttakt/social-adapters";
import { createTestServices, createTenant } from "./helpers";

let svc: Awaited<ReturnType<typeof createTestServices>>;
beforeAll(async () => {
  svc = await createTestServices();
});
afterAll(() => svc.close());

const appUrl = "http://localhost:3610";
const tokenFrom = (link: string | null) => link!.split("/invite/")[1]!;

describe("team invites & roles", () => {
  it("invites, delivers to outbox (not claimed as delivered), accepts with matching email", async () => {
    const t = await createTenant(svc, { plan: "agency" });
    const r = await inviteMember(svc.db, svc.mailer, t.actor, { email: "Editor@Example.test", role: "EDITOR", workspaceId: t.workspace.id, appUrl, organizationName: "Agentur" });
    expect(r.delivered).toBe(false);
    expect(r.link).toContain("/invite/");
    expect(svc.mailer.sent.at(-1)!.to).toBe("editor@example.test");
    expect(svc.mailer.sent.at(-1)!.subject).toContain("Einladung");

    const token = tokenFrom(r.link);
    expect((await getInvite(svc.db, token))!.role).toBe("EDITOR");
    const other = await registerUser(svc.db, { email: `other-${Date.now()}@example.test`, name: "Other", password: "Sicher-Passwort-123" });
    await expect(acceptInvite(svc.db, token, other)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const ed = await registerUser(svc.db, { email: "editor@example.test", name: "Editor", password: "Sicher-Passwort-123" });
    await acceptInvite(svc.db, token, ed);
    expect(await getInvite(svc.db, token)).toBeNull(); // single use
    const edActor = (await buildUserActor(svc.db, ed.id, t.organization.id))!;
    expect(edActor.kind === "user" && edActor.workspaceRoles[t.workspace.id]).toBe("EDITOR");
    expect((await listMembers(svc.db, t.actor)).map((m) => m.role).sort()).toEqual(["AGENCY_OWNER", "EDITOR"]);
  });

  it("rejects duplicate invites and invalid role scopes", async () => {
    const t = await createTenant(svc, { plan: "agency" });
    await inviteMember(svc.db, svc.mailer, t.actor, { email: "dup@example.test", role: "VIEWER", appUrl, organizationName: "A" });
    await expect(inviteMember(svc.db, svc.mailer, t.actor, { email: "dup@example.test", role: "VIEWER", appUrl, organizationName: "A" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(inviteMember(svc.db, svc.mailer, t.actor, { email: "c@example.test", role: "CLIENT_REVIEWER", appUrl, organizationName: "A" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(inviteMember(svc.db, svc.mailer, t.actor, { email: "s@example.test", role: "SUPER_ADMIN", appUrl, organizationName: "A" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("prevents privilege escalation and removing the last owner; enforces user limit", async () => {
    const t = await createTenant(svc, { plan: "pro" }); // pro: 3 users
    const adminInv = await inviteMember(svc.db, svc.mailer, t.actor, { email: `adm-${Date.now()}@example.test`, role: "AGENCY_ADMIN", appUrl, organizationName: "A" });
    const adm = await registerUser(svc.db, { email: (await getInvite(svc.db, tokenFrom(adminInv.link)))!.email, name: "Adm", password: "Sicher-Passwort-123" });
    await acceptInvite(svc.db, tokenFrom(adminInv.link), adm);
    const admActor = (await buildUserActor(svc.db, adm.id, t.organization.id))!;

    await expect(inviteMember(svc.db, svc.mailer, admActor, { email: "x@example.test", role: "AGENCY_OWNER", appUrl, organizationName: "A" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const members = await listMembers(svc.db, t.actor);
    const owner = members.find((m) => m.role === "AGENCY_OWNER")!;
    await expect(changeMemberRole(svc.db, admActor, owner.id, "VIEWER")).rejects.toMatchObject({ code: "FORBIDDEN" }); // higher role
    await expect(removeMember(svc.db, t.actor, owner.id)).rejects.toMatchObject({ code: "CONFLICT" }); // last owner
    await expect(changeMemberRole(svc.db, t.actor, owner.id, "AGENCY_ADMIN")).rejects.toMatchObject({ code: "CONFLICT" });

    await inviteMember(svc.db, svc.mailer, t.actor, { email: "third@example.test", role: "VIEWER", appUrl, organizationName: "A" });
    await expect(inviteMember(svc.db, svc.mailer, t.actor, { email: "fourth@example.test", role: "VIEWER", appUrl, organizationName: "A" })).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });

    // Removing a member revokes their sessions for this org
    const s = await login(svc.db, { email: adm.email, password: "Sicher-Passwort-123" });
    await svc.db.update(schema.sessions).set({ activeOrganizationId: t.organization.id }).where(eq(schema.sessions.userId, adm.id));
    const admMembership = (await listMembers(svc.db, t.actor)).find((m) => m.email === adm.email)!;
    await removeMember(svc.db, t.actor, admMembership.id);
    const [sess] = await svc.db.select().from(schema.sessions).where(eq(schema.sessions.userId, adm.id));
    expect(sess!.revokedAt).not.toBeNull();
    expect(s.token).toBeTruthy();
  });
});

describe("email tokens", () => {
  it("password reset is single-use, purpose-bound and unlocks the account", async () => {
    const email = `reset-${Date.now()}@example.test`;
    const u = await registerUser(svc.db, { email, name: "R", password: "Altes-Passwort-1" });
    const verifyToken = await createEmailVerification(svc.db, u.id);
    await expect(resetPassword(svc.db, verifyToken, "Neues-Passwort-22")).rejects.toMatchObject({ code: "VALIDATION_FAILED" }); // wrong purpose
    const r = (await createPasswordReset(svc.db, email))!;
    await resetPassword(svc.db, r.token, "Neues-Passwort-22");
    await expect(resetPassword(svc.db, r.token, "Noch-eins-333")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await login(svc.db, { email, password: "Neues-Passwort-22" })).user.id).toBe(u.id);
    expect(await createPasswordReset(svc.db, "nobody@example.test")).toBeNull();
  });
  it("email verification marks the user verified", async () => {
    const u = await registerUser(svc.db, { email: `verify-${Date.now()}@example.test`, name: "V", password: "Sicher-Passwort-123" });
    await verifyEmail(svc.db, await createEmailVerification(svc.db, u.id));
    const [row] = await svc.db.select().from(schema.users).where(eq(schema.users.id, u.id));
    expect(row!.emailVerifiedAt).not.toBeNull();
  });
});

describe("S3 SigV4 driver", () => {
  it("matches the official AWS presigned URL example", () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const d = new S3StorageDriver({
      endpoint: "https://s3.amazonaws.com",
      region: "us-east-1",
      bucket: "examplebucket",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      addressing: "virtual",
    });
    const url = d.presign("GET", "test.txt", 86400, new Date("2013-05-24T00:00:00Z"));
    expect(url).toContain("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
    expect(url.startsWith("https://examplebucket.s3.amazonaws.com/test.txt?")).toBe(true);
  });
  it("signs PUT requests with payload hash and path-style addressing", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const d = new S3StorageDriver({
      endpoint: "https://fsn1.your-objectstorage.com",
      region: "fsn1",
      bucket: "sichttakt-media",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch,
    });
    await d.put("org/ws/a b.jpg", Buffer.from("hello"), "image/jpeg");
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe("https://fsn1.your-objectstorage.com/sichttakt-media/org/ws/a%20b.jpg");
    expect(h["x-amz-content-sha256"]).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/fsn1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  });
});

describe("ClamAV INSTREAM client", () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((sock) => {
      const chunks: Buffer[] = [];
      sock.on("data", (d) => {
        chunks.push(d);
        const all = Buffer.concat(chunks);
        if (all.length >= 14 && all.subarray(all.length - 4).equals(Buffer.alloc(4))) {
          const infected = all.includes(Buffer.from("EICAR"));
          sock.end(infected ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => server.close());

  it("reports clean / infected / not_configured / error (fail closed)", async () => {
    expect(await clamavScan(Buffer.from("harmless"), "127.0.0.1", port)).toEqual({ status: "clean" });
    expect(await clamavScan(Buffer.from("X5O EICAR test"), "127.0.0.1", port)).toMatchObject({ status: "infected", signature: "Eicar-Test-Signature" });
    expect(await clamavScan(Buffer.from("x"), undefined)).toEqual({ status: "not_configured" });
    expect((await clamavScan(Buffer.from("x"), "127.0.0.1", 1)).status).toBe("error");
  });
});

describe("token refresh", () => {
  class FakeIg extends SandboxAdapter {
    mode: "ok" | "fail" = "ok";
    override async refreshToken() {
      if (this.mode === "fail") throw new ProviderError("Error validating access token", false, "META_190");
      return { accessToken: "renewed-token", expiresAt: new Date(Date.now() + 60 * 864e5) };
    }
  }
  const fake = new FakeIg();
  const deps = () => ({ db: svc.db, ring: svc.ring, registry: new AdapterRegistry(svc.config, { instagram_business: fake as unknown as PlatformAdapter }) });

  async function igChannel(orgId: string, wsId: string, ext: string) {
    const [ch] = await svc.db.insert(schema.channels).values({ organizationId: orgId, workspaceId: wsId, platform: "instagram_business", externalId: ext, displayName: "IG Kunde" }).returning();
    const enc = encrypt(svc.ring, "old-token");
    await svc.db.insert(schema.channelCredentials).values({ organizationId: orgId, channelId: ch!.id, accessTokenEnc: enc.value, keyVersion: enc.version, expiresAt: new Date(Date.now() + 3 * 864e5) });
    return ch!;
  }

  it("refreshes expiring tokens once per day (dedup) and stores the new token encrypted", async () => {
    const t = await createTenant(svc);
    const ch = await igChannel(t.organization.id, t.workspace.id, "ig-refresh-ok");
    const first = await scheduleTokenRefreshes(svc.db);
    expect(first.queued).toBeGreaterThanOrEqual(1);
    expect((await scheduleTokenRefreshes(svc.db)).queued).toBe(0);
    fake.mode = "ok";
    const jobs = (await claimJobs(svc.db, "w", { kinds: ["refresh_token"] })).filter((j) => j.payload.channelId === ch.id);
    expect(await processRefreshJob(deps(), jobs[0]!)).toBe("refreshed");
    const { auth } = await getChannelAuthForPublish(svc.db, svc.ring, ch.id);
    expect(auth.accessToken).toBe("renewed-token");
  });

  it("a refused refresh marks the channel needs_reauth, notifies admins and blocks publishing", async () => {
    const t = await createTenant(svc);
    const ch = await igChannel(t.organization.id, t.workspace.id, "ig-refresh-fail");
    await scheduleTokenRefreshes(svc.db, new Date(Date.now() + 864e5)); // new day → new job
    fake.mode = "fail";
    const job = (await claimJobs(svc.db, "w", { kinds: ["refresh_token"] })).find((j) => j.payload.channelId === ch.id)!;
    expect(await processRefreshJob(deps(), job)).toBe("needs_reauth");
    const [row] = await svc.db.select().from(schema.channels).where(eq(schema.channels.id, ch.id));
    expect(row!.status).toBe("needs_reauth");
    await expect(getChannelAuthForPublish(svc.db, svc.ring, ch.id)).rejects.toMatchObject({ code: "CHANNEL_NOT_ACTIVE" });
    const notes = await svc.db.select().from(schema.notifications).where(eq(schema.notifications.organizationId, t.organization.id));
    expect(notes.map((n) => n.kind)).toContain("channel_reauth");
  });
});
