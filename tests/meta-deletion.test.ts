import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@sichttakt/db";
import { createApiApp } from "@sichttakt/api";
import { getConfig } from "@sichttakt/config";
import { upsertChannel, parseMetaSignedRequest, metaDeletionCode } from "@sichttakt/core";
import { createTestServices, createTenant } from "./helpers";

const SECRET = "test-app-secret";
const sign = (payload: object, secret = SECRET) => {
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${createHmac("sha256", secret).update(p).digest("base64url")}.${p}`;
};
const form = (signed: string) => ({ method: "POST", body: new URLSearchParams({ signed_request: signed }), headers: { "content-type": "application/x-www-form-urlencoded" } });

let svc: Awaited<ReturnType<typeof createTestServices>>;
let app: ReturnType<typeof createApiApp>;

beforeAll(async () => {
  svc = await createTestServices();
  // same services, but with a Meta app secret configured (no other Meta credentials needed for the callbacks)
  svc.config = getConfig({ NODE_ENV: "test", API_URL: "http://localhost:3611", APP_URL: "https://www.postfino.com", META_APP_SECRET: SECRET } as NodeJS.ProcessEnv);
  app = createApiApp(svc);
});
afterAll(() => svc.close());

async function igChannel(t: Awaited<ReturnType<typeof createTenant>>, externalId: string, metaUserId: string) {
  return upsertChannel(svc.db, svc.ring, {
    organizationId: t.organization.id,
    workspaceId: t.workspace.id,
    platform: "instagram_business",
    userId: t.user.id,
    account: { externalId, displayName: "Studio Nord", username: "studionord", avatarUrl: "https://example.test/a.jpg", accessToken: "secret-token", grantedScopes: ["instagram_basic"], meta: { loginFlow: "facebook_login", metaUserId } },
  });
}

describe("Meta signed_request", () => {
  it("accepts a correctly signed request and rejects tampering, wrong secret and wrong algorithm", () => {
    const ok = sign({ algorithm: "HMAC-SHA256", user_id: "123", issued_at: Math.floor(Date.now() / 1000) });
    expect(parseMetaSignedRequest(ok, SECRET).user_id).toBe("123");
    expect(() => parseMetaSignedRequest(ok, "other-secret")).toThrow();
    const [sig, p] = ok.split(".");
    const forged = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "999" })).toString("base64url");
    expect(() => parseMetaSignedRequest(`${sig}.${forged}`, SECRET)).toThrow();
    expect(() => parseMetaSignedRequest(sign({ algorithm: "none", user_id: "123" }), SECRET)).toThrow();
    expect(() => parseMetaSignedRequest(`${sig}${p}`, SECRET)).toThrow();
    expect(() => parseMetaSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "123", issued_at: 1 }), SECRET)).toThrow();
  });
});

describe("Meta data deletion callback", () => {
  it("revokes and erases only the requesting Meta user's channels, answers with url + confirmation_code", async () => {
    const a = await createTenant(svc);
    const b = await createTenant(svc);
    const mine = await igChannel(a, "ig-a", "1001");
    const other = await igChannel(b, "ig-b", "2002");
    const issued = Math.floor(Date.now() / 1000);

    const res = await app.request("/api/v1/meta/data-deletion", form(sign({ algorithm: "HMAC-SHA256", user_id: "1001", issued_at: issued })));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; confirmation_code: string };
    expect(body.confirmation_code).toBe(metaDeletionCode(SECRET, "1001", issued));
    expect(body.url).toBe(`https://www.postfino.com/datenloeschung?code=${body.confirmation_code}`);

    const [ch] = await svc.db.select().from(schema.channels).where(eq(schema.channels.id, mine.id));
    expect(ch!.status).toBe("disconnected");
    expect(ch!.username).toBeNull();
    expect(ch!.avatarUrl).toBeNull();
    expect(ch!.meta).not.toHaveProperty("metaUserId");
    const [cred] = await svc.db.select().from(schema.channelCredentials).where(eq(schema.channelCredentials.channelId, mine.id));
    expect(cred!.accessTokenEnc).toBe("revoked");
    expect(cred!.revokedAt).not.toBeNull();

    // the other tenant's channel is untouched
    const [o] = await svc.db.select().from(schema.channels).where(eq(schema.channels.id, other.id));
    expect(o!.status).toBe("active");
    const [oc] = await svc.db.select().from(schema.channelCredentials).where(eq(schema.channelCredentials.channelId, other.id));
    expect(oc!.accessTokenEnc).not.toBe("revoked");
  });

  it("rejects an unsigned or forged request without touching data", async () => {
    const t = await createTenant(svc);
    const ch = await igChannel(t, "ig-c", "3003");
    const forged = sign({ algorithm: "HMAC-SHA256", user_id: "3003" }, "attacker-secret");
    expect((await app.request("/api/v1/meta/data-deletion", form(forged))).status).toBe(401);
    expect((await app.request("/api/v1/meta/data-deletion", form(""))).status).toBe(401);
    const [row] = await svc.db.select().from(schema.channels).where(eq(schema.channels.id, ch.id));
    expect(row!.status).toBe("active");
  });

  it("deauthorize revokes tokens but keeps the channel's profile data", async () => {
    const t = await createTenant(svc);
    const ch = await igChannel(t, "ig-d", "4004");
    const res = await app.request("/api/v1/meta/deauthorize", form(sign({ algorithm: "HMAC-SHA256", user_id: "4004" })));
    expect(res.status).toBe(200);
    const [row] = await svc.db.select().from(schema.channels).where(eq(schema.channels.id, ch.id));
    expect(row!.status).toBe("disconnected");
    expect(row!.username).toBe("studionord");
    const [cred] = await svc.db.select().from(schema.channelCredentials).where(eq(schema.channelCredentials.channelId, ch.id));
    expect(cred!.accessTokenEnc).toBe("revoked");
  });
});
