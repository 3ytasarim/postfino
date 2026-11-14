import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import { loadWorkspace, authorize } from "./tenancy";
import { recordLinkEvent } from "./startpage";
import { audit } from "./audit";
import type { Actor } from "./rbac";

// Link shortener on our own domain (no third-party tracking). Codes are random base62 (7 chars ≈ 3.5e12);
// the same target URL in a workspace is reused. Click statistics are first-party, without IP or cookies.

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export function randomCode(len = 7) {
  const bytes = randomBytes(len * 2);
  let out = "";
  for (let i = 0; out.length < len && i < bytes.length; i++) if (bytes[i]! < 248) out += ALPHABET[bytes[i]! % 62]; // rejection sampling → uniform
  return out.padEnd(len, "0");
}

export function assertShortenable(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new AppError("VALIDATION_FAILED", "invalid_url");
  }
  if (!/^https?:$/.test(u.protocol)) throw new AppError("VALIDATION_FAILED", "only_http_urls");
  if (url.length > 2000) throw new AppError("VALIDATION_FAILED", "url_too_long");
  return u.toString();
}

export async function createShortLink(db: Db, actor: Actor, p: { workspaceId: string; targetUrl: string; postId?: string }) {
  await loadWorkspace(db, actor, p.workspaceId, "posts.write");
  const target = assertShortenable(p.targetUrl);
  const [existing] = await db
    .select()
    .from(schema.shortLinks)
    .where(and(eq(schema.shortLinks.workspaceId, p.workspaceId), eq(schema.shortLinks.targetUrl, target), isNull(schema.shortLinks.disabledAt)));
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await db
      .insert(schema.shortLinks)
      .values({ organizationId: actor.organizationId, workspaceId: p.workspaceId, code: randomCode(), targetUrl: target, postId: p.postId, createdByUserId: actor.kind === "user" ? actor.userId : null })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) return rows[0];
  }
  throw new AppError("CONFLICT", "could_not_allocate_code");
}

/** Replaces every http(s) URL in a text with a short link (links already on the short domain are kept). */
export async function shortenLinksInText(db: Db, actor: Actor, p: { workspaceId: string; text: string; baseUrl: string }) {
  const base = p.baseUrl.replace(/\/$/, "");
  const urls = [...new Set(p.text.match(/https?:\/\/[^\s<>"]+/g) ?? [])].map((m) => m.replace(/[.,;:!?)\]]+$/, ""));
  let out = p.text;
  for (const url of urls) {
    if (url.startsWith(base)) continue;
    const link = await createShortLink(db, actor, { workspaceId: p.workspaceId, targetUrl: url });
    out = out.split(url).join(`${base}/${link.code}`);
  }
  return out;
}

export async function resolveShortLink(db: Db, code: string, ctx: { userAgent: string | null; referrer: string | null }) {
  if (!/^[0-9A-Za-z]{4,16}$/.test(code)) return null;
  const [l] = await db.select().from(schema.shortLinks).where(and(eq(schema.shortLinks.code, code), isNull(schema.shortLinks.disabledAt)));
  if (!l) return null;
  await db.update(schema.shortLinks).set({ clicks: sql`${schema.shortLinks.clicks} + 1` }).where(eq(schema.shortLinks.id, l.id));
  await recordLinkEvent(db, { organizationId: l.organizationId, workspaceId: l.workspaceId, kind: "short_click", shortLinkId: l.id, userAgent: ctx.userAgent, referrer: ctx.referrer });
  return l.targetUrl;
}

export async function listShortLinks(db: Db, actor: Actor, workspaceId: string) {
  await loadWorkspace(db, actor, workspaceId, "analytics.read");
  return db.select().from(schema.shortLinks).where(eq(schema.shortLinks.workspaceId, workspaceId)).orderBy(desc(schema.shortLinks.createdAt)).limit(200);
}

export async function disableShortLink(db: Db, actor: Actor, id: string) {
  const [l] = await db.select().from(schema.shortLinks).where(and(eq(schema.shortLinks.id, id), eq(schema.shortLinks.organizationId, actor.organizationId)));
  if (!l) throw new AppError("NOT_FOUND", "Link not found");
  authorize(actor, l.workspaceId, "posts.write");
  await db.update(schema.shortLinks).set({ disabledAt: new Date() }).where(eq(schema.shortLinks.id, l.id));
  await audit(db, { organizationId: l.organizationId, workspaceId: l.workspaceId, actor, action: "short_link.disabled", targetType: "short_link", targetId: l.id });
}
