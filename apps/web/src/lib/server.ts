import "server-only";
import { findRoot } from "./paths";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createServices, listChannels, getSession, buildUserActor, listOrganizationsForUser, listWorkspacesFor, seedReferenceData, type Services } from "@sichttakt/core";

export const SESSION_COOKIE = "st_session";

const g = globalThis as unknown as { __sichttakt?: Services; __seeded?: Promise<void> };
export function services(): Services {
  if (!g.__sichttakt) g.__sichttakt = createServices({ root: findRoot(process.cwd()), maxConnections: 10 });
  if (!g.__seeded) g.__seeded = seedReferenceData(g.__sichttakt.db);
  return g.__sichttakt;
}

/** Channels shown in the UI. Sandbox (MOCK) channels only when SANDBOX_ENABLED=true (development / QA). */
export async function listVisibleChannels(ctx: { svc: Services; actor: Parameters<typeof listChannels>[1] }, workspaceId?: string) {
  const rows = await listChannels(ctx.svc.db, ctx.actor, workspaceId);
  return ctx.svc.config.SANDBOX_ENABLED === "true" ? rows : rows.filter((r) => !r.is_sandbox);
}

/** Current session or null (no redirect). */
export const currentSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await getSession(services().db, token);
  return s ? { ...s, token: token! } : null;
});

/** Full app context; redirects to login / 2FA / onboarding when needed. */
export const requireContext = cache(async () => {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (s.session.twoFactorPending) redirect("/login/2fa");
  const svc = services();
  const orgs = await listOrganizationsForUser(svc.db, s.user.id);
  const orgId = orgs.find((o) => o.id === s.session.activeOrganizationId)?.id ?? orgs[0]?.id;
  if (!orgId) redirect("/onboarding");
  const actor = await buildUserActor(svc.db, s.user.id, orgId);
  if (!actor) redirect("/onboarding");
  const workspaces = await listWorkspacesFor(svc.db, actor);
  const workspace = workspaces.find((w) => w.id === s.session.activeWorkspaceId) ?? workspaces[0];
  if (!workspace) redirect("/onboarding");
  return { svc, session: s, user: s.user, actor, orgs, organization: orgs.find((o) => o.id === orgId)!, workspaces, workspace };
});
