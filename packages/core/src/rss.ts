import { and, eq, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import { assertPublicUrl } from "./net-guard";
import { loadWorkspace, authorize } from "./tenancy";
import { createIdea } from "./ideas";
import { enqueue } from "./queue";
import { audit } from "./audit";
import type { Actor } from "./rbac";

// RSS / Atom feeds → ideas. Dependency-free tolerant parser (title, link, guid/id, summary/description, date).
// Each item becomes at most one idea per workspace (unique source_ref) — re-fetching is idempotent.

export type FeedItem = { id: string; title: string; link?: string; summary: string; publishedAt?: string };

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
const stripHtml = (s: string) => decode(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? decode(m[1]!.trim()) : undefined;
};

export function parseFeed(xml: string): { title?: string; items: FeedItem[] } {
  const isAtom = /<feed[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const channelTitle = tag(xml.replace(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi, ""), "title");
  const items: FeedItem[] = [];
  for (const b of blocks.slice(0, 100)) {
    let link = tag(b, "link");
    if (isAtom || !link) {
      const href = /<link\b[^>]*?href="([^"]+)"[^>]*?(?:rel="alternate"[^>]*)?\/?>/i.exec(b);
      link = href?.[1] ?? link;
    }
    const id = tag(b, "guid") ?? tag(b, "id") ?? link;
    const title = stripHtml(tag(b, "title") ?? "");
    if (!id || !title) continue;
    items.push({
      id: id.slice(0, 500),
      title: title.slice(0, 300),
      link: link && /^https?:\/\//.test(link) ? link : undefined,
      summary: stripHtml(tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content") ?? "").slice(0, 2000),
      publishedAt: tag(b, "pubDate") ?? tag(b, "updated") ?? tag(b, "published"),
    });
  }
  return { title: channelTitle ? stripHtml(channelTitle) : undefined, items };
}

export async function addFeed(db: Db, actor: Actor, p: { workspaceId: string; url: string; boardId?: string; allowPrivate?: boolean }) {
  await loadWorkspace(db, actor, p.workspaceId, "ideas.write");
  try {
    await assertPublicUrl(p.url, p.allowPrivate);
  } catch (e) {
    throw new AppError("VALIDATION_FAILED", `Feed URL rejected: ${(e as Error).message}`);
  }
  const [f] = await db.insert(schema.rssFeeds).values({ organizationId: actor.organizationId, workspaceId: p.workspaceId, url: p.url, boardId: p.boardId }).onConflictDoNothing().returning();
  if (!f) throw new AppError("CONFLICT", "Feed already added");
  await enqueue(db, { kind: "fetch_rss", organizationId: actor.organizationId, payload: { feedId: f.id }, dedupKey: `rss:${f.id}:initial` });
  await audit(db, { organizationId: actor.organizationId, workspaceId: p.workspaceId, actor, action: "rss.added", targetType: "rss_feed", targetId: f.id, metadata: { url: p.url } });
  return f;
}

export async function listFeeds(db: Db, actor: Actor, workspaceId: string) {
  await loadWorkspace(db, actor, workspaceId, "posts.read");
  return db.select().from(schema.rssFeeds).where(eq(schema.rssFeeds.workspaceId, workspaceId));
}

export async function removeFeed(db: Db, actor: Actor, feedId: string) {
  const [f] = await db.select().from(schema.rssFeeds).where(and(eq(schema.rssFeeds.id, feedId), eq(schema.rssFeeds.organizationId, actor.organizationId)));
  if (!f) throw new AppError("NOT_FOUND", "Feed not found");
  authorize(actor, f.workspaceId, "ideas.write");
  await db.delete(schema.rssFeeds).where(eq(schema.rssFeeds.id, f.id));
}

/** Worker: fetch one feed (conditional GET), create ideas for new items. */
export async function fetchFeed(db: Db, feedId: string, opts: { http?: typeof fetch; allowPrivate?: boolean; maxBytes?: number } = {}) {
  const [f] = await db.select().from(schema.rssFeeds).where(eq(schema.rssFeeds.id, feedId));
  if (!f || !f.active) return { created: 0, skipped: true };
  const http = opts.http ?? fetch;
  const system = { kind: "system" as const, organizationId: f.organizationId };
  try {
    await assertPublicUrl(f.url, opts.allowPrivate);
    const res = await http(f.url, {
      headers: { "user-agent": "Postfino-RSS/1 (+https://www.postfino.com)", accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8", ...(f.etag ? { "if-none-match": f.etag } : {}), ...(f.lastModified ? { "if-modified-since": f.lastModified } : {}) },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 304) {
      await db.update(schema.rssFeeds).set({ lastFetchedAt: new Date(), lastError: null }).where(eq(schema.rssFeeds.id, f.id));
      return { created: 0, notModified: true };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > (opts.maxBytes ?? 5_000_000)) throw new Error("feed too large");
    const feed = parseFeed(text);
    let created = 0;
    for (const it of feed.items) {
      const idea = await createIdea(db, system, { workspaceId: f.workspaceId, boardId: f.boardId ?? undefined, title: it.title, body: it.summary, links: it.link ? [it.link] : [], source: "rss", sourceRef: it.id });
      if (idea) created++;
    }
    await db
      .update(schema.rssFeeds)
      .set({ title: f.title ?? feed.title ?? null, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"), lastFetchedAt: new Date(), lastError: null })
      .where(eq(schema.rssFeeds.id, f.id));
    return { created };
  } catch (e) {
    await db.update(schema.rssFeeds).set({ lastFetchedAt: new Date(), lastError: (e as Error).message.slice(0, 300) }).where(eq(schema.rssFeeds.id, f.id));
    return { created: 0, error: (e as Error).message };
  }
}

/** Enqueue a fetch for each active feed once per 30-minute window (dedup). */
export async function scheduleFeedFetches(db: Db, now = new Date()) {
  const feeds = await db.select({ id: schema.rssFeeds.id, org: schema.rssFeeds.organizationId }).from(schema.rssFeeds).where(eq(schema.rssFeeds.active, true));
  const slot = Math.floor(now.getTime() / 1_800_000);
  for (const f of feeds) await enqueue(db, { kind: "fetch_rss", organizationId: f.org, payload: { feedId: f.id }, dedupKey: `rss:${f.id}:${slot}`, maxAttempts: 2 });
  return feeds.length;
}
