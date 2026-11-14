import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { and, eq, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import { authorize } from "./tenancy";
import { assertFeature, getEntitlements } from "./entitlements";
import { audit } from "./audit";
import type { Actor } from "./rbac";

// White-label (plan feature "white_label"): app name, logo and accent colour on client-facing surfaces
// (review portal, Start Pages), optional removal of the "made with SichtTakt" line, and a custom domain whose
// ownership is proven with a DNS TXT record. Routing the domain to SichtTakt (CNAME + TLS certificate on the
// server) is a deploy step.

export type Branding = { appName?: string; logoAssetId?: string; accentColor?: string; hidePoweredBy?: boolean; customDomain?: string; domainToken?: string; domainVerifiedAt?: string };

const HEX = /^#[0-9a-f]{6}$/i;
const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Public view for client-facing pages. Returns {} when the plan does not include white-label (e.g. after a downgrade). */
export async function publicBranding(db: Db, organizationId: string): Promise<Pick<Branding, "appName" | "logoAssetId" | "accentColor" | "hidePoweredBy">> {
  const ent = await getEntitlements(db, organizationId).catch(() => null);
  if (!ent?.features.has("white_label")) return {};
  const [org] = await db.select({ branding: schema.organizations.branding }).from(schema.organizations).where(eq(schema.organizations.id, organizationId));
  const b = (org?.branding ?? {}) as Branding;
  return { appName: b.appName, logoAssetId: b.logoAssetId, accentColor: b.accentColor, hidePoweredBy: b.hidePoweredBy };
}

export async function getBranding(db: Db, actor: Actor) {
  authorize(actor, null, "org.manage");
  const [org] = await db.select({ branding: schema.organizations.branding }).from(schema.organizations).where(eq(schema.organizations.id, actor.organizationId));
  return (org?.branding ?? {}) as Branding;
}

export async function updateBranding(db: Db, actor: Actor, p: { appName?: string; logoAssetId?: string | null; accentColor?: string; hidePoweredBy?: boolean }) {
  authorize(actor, null, "org.manage");
  await assertFeature(db, actor.organizationId, "white_label");
  const cur = await getBranding(db, actor);
  if (p.accentColor && !HEX.test(p.accentColor)) throw new AppError("VALIDATION_FAILED", "invalid_color");
  if (p.logoAssetId) {
    const [a] = await db.select().from(schema.mediaAssets).where(and(eq(schema.mediaAssets.id, p.logoAssetId), eq(schema.mediaAssets.organizationId, actor.organizationId)));
    if (!a || a.kind !== "image" || a.status !== "ready") throw new AppError("MEDIA_INVALID", "logo_must_be_ready_image");
  }
  const next: Branding = {
    ...cur,
    ...(p.appName !== undefined ? { appName: p.appName.trim().slice(0, 40) || undefined } : {}),
    ...(p.logoAssetId !== undefined ? { logoAssetId: p.logoAssetId ?? undefined } : {}),
    ...(p.accentColor !== undefined ? { accentColor: p.accentColor || undefined } : {}),
    ...(p.hidePoweredBy !== undefined ? { hidePoweredBy: p.hidePoweredBy } : {}),
  };
  await db.update(schema.organizations).set({ branding: next, updatedAt: new Date() }).where(eq(schema.organizations.id, actor.organizationId));
  await audit(db, { organizationId: actor.organizationId, actor, action: "branding.updated", metadata: { appName: next.appName, accentColor: next.accentColor, hidePoweredBy: next.hidePoweredBy } });
  return next;
}

/** Sets (or clears) the custom domain and issues a new verification token. */
export async function setCustomDomain(db: Db, actor: Actor, domain: string | null) {
  authorize(actor, null, "org.manage");
  await assertFeature(db, actor.organizationId, "white_label");
  const cur = await getBranding(db, actor);
  if (!domain) {
    const rest: Branding = { ...cur };
    delete rest.customDomain;
    delete rest.domainToken;
    delete rest.domainVerifiedAt;
    await db.update(schema.organizations).set({ branding: rest, updatedAt: new Date() }).where(eq(schema.organizations.id, actor.organizationId));
    return rest;
  }
  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!DOMAIN.test(d) || /sichttakt|bleibsichtbar/.test(d)) throw new AppError("VALIDATION_FAILED", "invalid_domain");
  const all = await db.select({ id: schema.organizations.id, branding: schema.organizations.branding }).from(schema.organizations);
  if (all.some((o) => o.id !== actor.organizationId && (o.branding as Branding).customDomain === d && (o.branding as Branding).domainVerifiedAt)) throw new AppError("CONFLICT", "domain_taken");
  const next: Branding = { ...cur, customDomain: d, domainToken: `sichttakt-verify=${randomBytes(16).toString("hex")}`, domainVerifiedAt: undefined };
  await db.update(schema.organizations).set({ branding: next, updatedAt: new Date() }).where(eq(schema.organizations.id, actor.organizationId));
  await audit(db, { organizationId: actor.organizationId, actor, action: "branding.domain_set", metadata: { domain: d } });
  return next;
}

/** Checks the TXT record `_sichttakt.<domain>` for the token. `resolver` is injectable for tests. */
export async function verifyCustomDomain(db: Db, actor: Actor, resolver: (name: string) => Promise<string[][]> = resolveTxt) {
  authorize(actor, null, "org.manage");
  const cur = await getBranding(db, actor);
  if (!cur.customDomain || !cur.domainToken) throw new AppError("CONFLICT", "no_domain");
  let records: string[][] = [];
  try {
    records = await resolver(`_sichttakt.${cur.customDomain}`);
  } catch {
    records = [];
  }
  const ok = records.some((r) => r.join("") === cur.domainToken);
  if (!ok) return { verified: false as const, expected: { name: `_sichttakt.${cur.customDomain}`, type: "TXT", value: cur.domainToken } };
  const next = { ...cur, domainVerifiedAt: new Date().toISOString() };
  await db.update(schema.organizations).set({ branding: next, updatedAt: new Date() }).where(eq(schema.organizations.id, actor.organizationId));
  await audit(db, { organizationId: actor.organizationId, actor, action: "branding.domain_verified", metadata: { domain: cur.customDomain } });
  return { verified: true as const };
}
