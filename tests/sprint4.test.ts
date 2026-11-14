import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, schema } from "@sichttakt/db";
import {
  AdapterRegistry,
  createPost,
  collectPostInsights,
  collectAccountInsights,
  getInsightsOverview,
  computeTakeaways,
  listPostInsights,
  scheduleInsightCollection,
  syncComments,
  listThreads,
  getThread,
  replyToComment,
  setThreadStatus,
  commentToIdea,
  communityStats,
  saveSavedReply,
  listSavedReplies,
  createReport,
  processReportJob,
  getReportFile,
  readZip,
  pdfString,
  PdfDoc,
  claimJobs,
} from "@sichttakt/core";
import { SandboxAdapter, InstagramAdapter, type PlatformAdapter, type ChannelAuth, type ProviderComment } from "@sichttakt/social-adapters";
import { createTestServices, createTenant, uploadAsset } from "./helpers";
import { jpeg } from "./fixtures";

/** Test double: a "network" with metrics and comments (the real sandbox returns N/A for everything). */
class FakeNetwork extends SandboxAdapter {
  metrics = new Map<string, Record<string, number | null>>();
  account: Record<string, number | null> = { followers: 1000, media_count: 10, profile_views: null, reach: null };
  comments = new Map<string, ProviderComment[]>();
  replies: { commentId: string; text: string }[] = [];
  override async fetchInsights(_a: ChannelAuth, id: string) {
    return this.metrics.get(id) ?? { likes: null, comments: null, reach: null, views: null, saves: null, shares: null, interactions: null };
  }
  override async fetchAccountInsights() {
    return { ...this.account };
  }
  override async listComments(_a: ChannelAuth, id: string) {
    return this.comments.get(id) ?? [];
  }
  override async replyComment(_a: ChannelAuth, commentId: string, text: string) {
    this.replies.push({ commentId, text });
    return { id: `reply_${this.replies.length}` };
  }
}

let svc: Awaited<ReturnType<typeof createTestServices>>;
const net = new FakeNetwork();
let deps: { db: typeof svc.db; ring: typeof svc.ring; registry: AdapterRegistry };
beforeAll(async () => {
  svc = await createTestServices();
  deps = { db: svc.db, ring: svc.ring, registry: new AdapterRegistry(svc.config, { sandbox: net as unknown as PlatformAdapter }) };
});
afterAll(() => svc.close());

/** Creates a post + target and marks it published at `at` (bypasses the worker for analytics fixtures). */
async function published(t: Awaited<ReturnType<typeof createTenant>>, at: Date, caption: string, type: "image" | "text" = "text") {
  const media = type === "image" ? [(await uploadAsset(svc, t.actor, t.workspace.id, "image", { width: 1080, height: 1080 })).id] : [];
  const { post } = await createPost(svc.db, deps.registry, t.actor, { workspace_id: t.workspace.id, account_ids: [t.channel.id], type, caption, media_asset_ids: media, status: "draft", publish_mode: "automatic" } as never);
  const [target] = await svc.db.select().from(schema.postTargets).where(eq(schema.postTargets.postId, post.id));
  const ext = `ext_${crypto.randomUUID().slice(0, 8)}`;
  await svc.db.update(schema.postTargets).set({ status: "PUBLISHED", externalPostId: ext, publishedAt: at }).where(eq(schema.postTargets.id, target!.id));
  const [pp] = await svc.db
    .insert(schema.publishedPosts)
    .values({ organizationId: t.organization.id, workspaceId: t.workspace.id, postTargetId: target!.id, channelId: t.channel.id, platform: "sandbox", externalPostId: ext, permalink: `https://x.test/${ext}`, publishedAt: at })
    .returning();
  return pp!;
}

const d = (s: string) => new Date(s);

describe("insights", () => {
  it("stores metrics with source + collectedAt; N/A stays N/A; totals, deltas, engagement rate", async () => {
    const t = await createTenant(svc);
    const a = await published(t, d("2026-10-05T10:00:00Z"), "A");
    const b = await published(t, d("2026-10-12T10:00:00Z"), "B");
    const old = await published(t, d("2026-09-20T10:00:00Z"), "alt");
    net.metrics.set(a.externalPostId, { reach: 1000, likes: 80, comments: 10, saves: null, shares: 10, views: 1500, interactions: null });
    net.metrics.set(b.externalPostId, { reach: 500, likes: 20, comments: 5, saves: null, shares: 0, views: null, interactions: null });
    net.metrics.set(old.externalPostId, { reach: 750, likes: 30, comments: 5, saves: null, shares: 5, views: 700, interactions: null });
    for (const p of [a, b, old]) await collectPostInsights(deps, p.id, d("2026-10-20T00:00:00Z"));

    const [snap] = await svc.db.select().from(schema.analyticsSnapshots).where(eq(schema.analyticsSnapshots.publishedPostId, a.id));
    expect(snap!.sourcePlatform).toBe("sandbox");
    expect(snap!.collectedAt.toISOString()).toBe("2026-10-20T00:00:00.000Z");

    const ov = await getInsightsOverview(svc.db, t.actor, { workspaceId: t.workspace.id, from: d("2026-10-01T00:00:00Z"), to: d("2026-10-31T00:00:00Z") });
    expect(ov.sampleSize).toBe(2);
    expect(ov.summary.reach!.current).toMatchObject({ value: 1500, status: "ok" });
    expect(ov.summary.saves!.current).toMatchObject({ value: null, status: "not_available" }); // never 0
    expect(ov.summary.views!.current.value).toBe(1500); // only posts that have the metric
    expect(ov.summary.reach!.previous.value).toBe(750);
    expect(ov.summary.reach!.deltaPct).toBe(100);
    expect(ov.summary.engagement_rate!.current.value).toBe(8.33); // (100+0+10+0... ) = (80+20+10+5+10+0)/1500
    const pa = (await listPostInsights(svc.db, t.actor, { workspaceId: t.workspace.id, from: d("2026-10-01T00:00:00Z"), to: d("2026-10-31T00:00:00Z") })).find((x) => x.publishedPostId === a.id)!;
    expect(pa.metrics.engagement_rate).toMatchObject({ value: 10, status: "ok" }); // (80+10+10)/1000
  });

  it("not collected vs not available; account followers growth", async () => {
    const t = await createTenant(svc);
    await published(t, d("2026-10-05T10:00:00Z"), "nie erhoben");
    net.account = { followers: 1000, media_count: 1, profile_views: null, reach: null };
    await collectAccountInsights(deps, t.channel.id, d("2026-10-02T00:00:00Z"));
    net.account = { followers: 1042, media_count: 2, profile_views: null, reach: null };
    await collectAccountInsights(deps, t.channel.id, d("2026-10-25T00:00:00Z"));
    const ov = await getInsightsOverview(svc.db, t.actor, { workspaceId: t.workspace.id, from: d("2026-10-01T00:00:00Z"), to: d("2026-10-31T00:00:00Z") });
    expect(ov.summary.likes!.current.status).toBe("not_available"); // post exists but no snapshot → N/A
    expect(ov.posts[0]!.metrics.likes!.status).toBe("not_collected");
    expect(ov.accounts[0]).toMatchObject({ followers: { value: 1042 }, followerGrowth: 42 });
  });

  it("collection scheduling skips sandbox accounts for account metrics and dedups per window", async () => {
    const first = await scheduleInsightCollection(svc.db, d("2026-10-20T01:00:00Z"));
    const second = await scheduleInsightCollection(svc.db, d("2026-10-20T02:00:00Z"));
    expect(first.channels).toBe(0);
    const jobs = await claimJobs(svc.db, "w", { kinds: ["collect_insights"], now: new Date(Date.now() + 60_000), limit: 1000 });
    expect(jobs.length).toBe(first.posts); // same 6h slot → no duplicates
    expect(second.posts).toBe(first.posts);
  });

  it("takeaways need a minimum sample and cite their evidence", async () => {
    const t = await createTenant(svc);
    const range = { from: d("2026-09-01T00:00:00Z"), to: d("2026-10-31T00:00:00Z") };
    const p1 = await published(t, d("2026-09-07T08:00:00Z"), "Montag 1");
    net.metrics.set(p1.externalPostId, { reach: 100, likes: 30, comments: 0, saves: 0, shares: 0, views: null, interactions: null });
    await collectPostInsights(deps, p1.id);
    let posts = await listPostInsights(svc.db, t.actor, { workspaceId: t.workspace.id, ...range });
    expect(computeTakeaways(posts, "Europe/Berlin", range)[0]!.kind).toBe("insufficient_data");
    const plan: [string, number][] = [["2026-09-14T08:00:00Z", 28], ["2026-09-16T08:00:00Z", 5], ["2026-09-17T08:00:00Z", 6], ["2026-09-23T08:00:00Z", 4], ["2026-09-24T08:00:00Z", 5], ["2026-09-21T08:00:00Z", 32]];
    for (const [at, likes] of plan) {
      const p = await published(t, d(at), `Post ${at}`);
      net.metrics.set(p.externalPostId, { reach: 100, likes, comments: 0, saves: 0, shares: 0, views: null, interactions: null });
      await collectPostInsights(deps, p.id);
    }
    posts = await listPostInsights(svc.db, t.actor, { workspaceId: t.workspace.id, ...range });
    const tk = computeTakeaways(posts, "Europe/Berlin", range);
    const wd = tk.find((x) => x.kind === "best_weekday")!;
    expect(wd.text.de).toMatch(/^Beiträge am Mo erzielen \d+ % mehr Interaktionsrate/);
    expect(wd.evidence).toMatchObject({ sample: 7, metric: "engagement_rate", from: "2026-09-01", to: "2026-10-31" });
  });
});

describe("community", () => {
  it("syncs comments idempotently, lists unanswered, replies via the adapter, stats", async () => {
    const t = await createTenant(svc);
    const pp = await published(t, d("2026-10-05T10:00:00Z"), "Neue Torte");
    net.comments.set(pp.externalPostId, [
      { id: "c1", text: "Wie lange habt ihr offen?", username: "kunde1", timestamp: "2026-10-05T11:00:00Z" },
      { id: "c2", text: "Lecker!", username: "kunde2", timestamp: "2026-10-05T12:00:00Z" },
    ]);
    expect((await syncComments(deps, pp.id)).added).toBe(2);
    expect((await syncComments(deps, pp.id)).added).toBe(0);
    let threads = await listThreads(svc.db, t.actor, { workspaceId: t.workspace.id });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ unansweredCount: 2, postCaption: "Neue Torte" });
    const { comments } = await getThread(svc.db, t.actor, threads[0]!.id);
    const c1 = comments.find((c) => c.externalCommentId === "c1")!;
    const own = await replyToComment(deps, t.actor, c1.id, "Bis 18 Uhr 🙂");
    expect(own.isOwn).toBe(true);
    expect(net.replies.at(-1)).toEqual({ commentId: "c1", text: "Bis 18 Uhr 🙂" });
    threads = await listThreads(svc.db, t.actor, { workspaceId: t.workspace.id });
    expect(threads[0]!.unansweredCount).toBe(1);
    const stats = await communityStats(svc.db, t.actor, { workspaceId: t.workspace.id, from: d("2026-10-01T00:00:00Z"), to: new Date(Date.now() + 864e5) });
    expect(stats).toMatchObject({ received: 2, replied: 1, replyRate: 50 });
    await setThreadStatus(svc.db, t.actor, threads[0]!.id, "resolved");
    expect(await listThreads(svc.db, t.actor, { workspaceId: t.workspace.id })).toHaveLength(0);
    const idea = await commentToIdea(svc.db, t.actor, comments.find((c) => c.externalCommentId === "c2")!.id);
    expect(idea!.source).toBe("comment");
    await saveSavedReply(svc.db, t.actor, t.workspace.id, { title: "Danke", body: "Danke für dein Feedback!" });
    expect(await listSavedReplies(svc.db, t.actor, t.workspace.id)).toHaveLength(1);
  });

  it("another tenant cannot read or reply", async () => {
    const a = await createTenant(svc);
    const b = await createTenant(svc);
    const pp = await published(a, d("2026-10-05T10:00:00Z"), "privat");
    net.comments.set(pp.externalPostId, [{ id: "x1", text: "hi", username: "u", timestamp: "2026-10-05T11:00:00Z" }]);
    await syncComments(deps, pp.id);
    const [th] = await listThreads(svc.db, a.actor, { workspaceId: a.workspace.id });
    const { comments } = await getThread(svc.db, a.actor, th!.id);
    await expect(getThread(svc.db, b.actor, th!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(replyToComment(deps, b.actor, comments[0]!.id, "hack")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("reports", () => {
  it("CSV (zip), Markdown and PDF keep N/A; branded needs Agency", async () => {
    const t = await createTenant(svc, { plan: "pro" });
    const p = await published(t, d("2026-10-05T10:00:00Z"), "Bericht-Post mit Ümläuten ß €");
    net.metrics.set(p.externalPostId, { reach: 400, likes: 40, comments: null, saves: null, shares: 4, views: null, interactions: null });
    await collectPostInsights(deps, p.id);
    const cfg = { from: "2026-10-01T00:00:00Z", to: "2026-10-31T00:00:00Z" };
    const csv = await createReport(svc.db, t.actor, { workspaceId: t.workspace.id, title: "Oktober", format: "csv", config: cfg });
    const md = await createReport(svc.db, t.actor, { workspaceId: t.workspace.id, title: "Oktober", format: "md", config: cfg });
    const pdf = await createReport(svc.db, t.actor, { workspaceId: t.workspace.id, title: "Oktober Bericht", format: "pdf", config: cfg });
    for (const r of [csv, md, pdf]) await processReportJob(svc, r.id);
    const zip = readZip((await getReportFile(svc.db, svc.storage, t.actor, csv.id)).data);
    expect([...zip.keys()].sort()).toEqual(["accounts.csv", "posts.csv", "summary.csv"]);
    expect(zip.get("posts.csv")!.toString()).toContain("N/A");
    const mdText = (await getReportFile(svc.db, svc.storage, t.actor, md.id)).data.toString();
    expect(mdText).toContain("| Kommentare | N/A |");
    expect(mdText).toContain("Interaktionsrate | 11 %"); // (40+4)/400
    const pdfFile = await getReportFile(svc.db, svc.storage, t.actor, pdf.id);
    expect(pdfFile.contentType).toBe("application/pdf");
    const raw = pdfFile.data.toString("latin1");
    expect(raw.startsWith("%PDF-1.4")).toBe(true);
    expect(raw).toContain("%%EOF");
    expect(raw).toContain("(Oktober Bericht)");
    const logo = await uploadAsset(svc, t.actor, t.workspace.id, "image", { width: 400, height: 100 });
    await expect(createReport(svc.db, t.actor, { workspaceId: t.workspace.id, title: "x", format: "pdf", config: { ...cfg, logoAssetId: logo.id } })).rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
  });

  it("branded PDF embeds the JPEG logo (Agency)", async () => {
    const t = await createTenant(svc, { plan: "agency" });
    const logo = await uploadAsset(svc, t.actor, t.workspace.id, "image", { width: 400, height: 100 });
    const r = await createReport(svc.db, t.actor, { workspaceId: t.workspace.id, title: "Kunde", format: "pdf", config: { from: "2026-10-01T00:00:00Z", to: "2026-10-31T00:00:00Z", logoAssetId: logo.id, footer: "Agentur XY" } });
    await processReportJob(svc, r.id);
    const raw = (await getReportFile(svc.db, svc.storage, t.actor, r.id)).data.toString("latin1");
    expect(raw).toContain("/Subtype /Image /Width 400 /Height 100");
    expect(raw).toContain("Agentur XY");
  });

  it("PDF strings use WinAnsi for German and escape parentheses", () => {
    expect(pdfString("Größe (€) ş 🙂")).toBe(`(Gr\xf6\xdfe \\(\x80\\) s )`);
    const doc = new PdfDoc();
    doc.text(10, 10, "x");
    expect(doc.toBuffer({ title: "t" }).toString("latin1")).toMatch(/xref\n0 \d+\n0000000000 65535 f /);
  });
});

describe("Instagram adapter: insights & comments contract", () => {
  const calls: string[] = [];
  const responses: Record<string, unknown>[] = [];
  const http = (async (url: URL | string) => {
    calls.push(String(url));
    const r = responses.shift() ?? {};
    return new Response(JSON.stringify(r), { status: (r.__status as number) ?? 200 });
  }) as typeof fetch;
  const ig = new InstagramAdapter({ appId: "a", appSecret: "s", graphVersion: "v27.0", fetch: http });
  const auth = { accessToken: "T", externalId: "1784", meta: {} };

  it("maps fields + insights; unsupported metrics stay null", async () => {
    responses.push(
      { like_count: 12, comments_count: 3, media_product_type: "FEED" },
      { data: [{ name: "reach", values: [{ value: 400 }] }] },
      { __status: 400, error: { message: "metric views not supported", code: 100 } },
      { data: [{ name: "saved", values: [{ value: 7 }] }] },
      { data: [{ name: "shares", values: [{ value: 2 }] }] },
      { data: [{ name: "total_interactions", total_value: { value: 24 } }] },
    );
    const m = await ig.fetchInsights(auth, "m1");
    expect(m).toEqual({ likes: 12, comments: 3, reach: 400, views: null, saves: 7, shares: 2, interactions: 24 });
    expect(calls.some((c) => c.includes("/m1/insights") && c.includes("metric=reach"))).toBe(true);
  });

  it("flattens replies with parent ids", async () => {
    responses.push({ data: [{ id: "c1", text: "Hallo", username: "a", timestamp: "2026-10-05T10:00:00+0000", replies: { data: [{ id: "r1", text: "Hi", username: "cafe", timestamp: "2026-10-05T10:05:00+0000" }] } }] });
    expect(await ig.listComments(auth, "m1")).toEqual([
      { id: "c1", text: "Hallo", username: "a", timestamp: "2026-10-05T10:00:00+0000" },
      { id: "r1", text: "Hi", username: "cafe", timestamp: "2026-10-05T10:05:00+0000", parentId: "c1" },
    ]);
  });
});

void jpeg;
