import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sichttakt/db";
import { login, registerUser } from "@sichttakt/core";
import { createTestServices, createTenant } from "./helpers";

let svc: Awaited<ReturnType<typeof createTestServices>>;
beforeAll(async () => {
  svc = await createTestServices();
});
afterAll(() => svc.close());

describe("registering again with an unconfirmed email", () => {
  it("restarts an unfinished sign-up: same user, new name and password, old codes void", async () => {
    const email = `neu-${Date.now()}@example.test`;
    const first = await registerUser(svc.db, { email, name: "Erst", password: "Erstes-Passwort-1" });
    await svc.db.insert(schema.loginChallenges).values({ userId: first.id, tokenHash: "old", codeHash: "x", purpose: "signup", expiresAt: new Date(Date.now() + 600_000) });

    const again = await registerUser(svc.db, { email: email.toUpperCase(), name: "Zweit", password: "Zweites-Passwort-2" });
    expect(again.id).toBe(first.id);
    expect(again.name).toBe("Zweit");
    expect(await svc.db.select().from(schema.loginChallenges).where(eq(schema.loginChallenges.userId, first.id))).toHaveLength(0);
    await expect(login(svc.db, { email, password: "Erstes-Passwort-1" })).rejects.toBeTruthy();
    await expect(login(svc.db, { email, password: "Zweites-Passwort-2" })).resolves.toBeTruthy();
  });

  it("still refuses confirmed accounts and accounts that belong to a team", async () => {
    const verified = await registerUser(svc.db, { email: `ok-${Date.now()}@example.test`, name: "Ok", password: "Sicher-Passwort-123" });
    await svc.db.update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, verified.id));
    await expect(registerUser(svc.db, { email: verified.email, name: "X", password: "Anderes-Passwort-9" })).rejects.toMatchObject({ message: "email_taken" });

    const t = await createTenant(svc); // owner of a team, email not confirmed in the helper
    await expect(registerUser(svc.db, { email: t.user.email, name: "X", password: "Anderes-Passwort-9" })).rejects.toMatchObject({ message: "email_taken" });
  });
});
