import { and, desc, eq, gte, inArray, isNull, lte, schema, type Db } from "@sichttakt/db";
import { utcToWallClock, type Platform } from "@sichttakt/shared";
import { getChannelAuthForPublish, effectiveCapability, type AdapterRegistry } from "./channels";
import { loadWorkspace } from "./tenancy";
import { enqueue } from "./queue";
import type { Keyring } from "./crypto";
import type { Actor } from "./rbac";

// Insights. Every stored value carries source platform + collectedAt. A metric the platform
// does not provide is stored with available=false / value NULL and shown as "N/A" — never as 0.

export const METRICS = {
  followers: { de: "Follower", en: "Followers", tr: "Takipçi", desc: { de: "Follower des Kontos zum Zeitpunkt der Abfrage.", en: "Account followers at collection time.", tr: "Toplama anındaki takipçi sayısı." } },
  reach: { de: "Reichweite", en: "Reach", tr: "Erişim", desc: { de: "Eindeutige Konten, die den Beitrag gesehen haben.", en: "Unique accounts that saw the post.", tr: "Gönderiyi gören benzersiz hesaplar." } },
  views: { de: "Aufrufe", en: "Views", tr: "Görüntülenme", desc: { de: "Wie oft der Beitrag angezeigt / abgespielt wurde.", en: "How often the post was shown / played.", tr: "Gönderinin gösterilme / oynatılma sayısı." } },
  likes: { de: "Likes", en: "Likes", tr: "Beğeni", desc: { de: "Likes bzw. Reaktionen.", en: "Likes or reactions.", tr: "Beğeni veya tepkiler." } },
  comments: { de: "Kommentare", en: "Comments", tr: "Yorum", desc: { de: "Anzahl der Kommentare.", en: "Number of comments.", tr: "Yorum sayısı." } },
  saves: { de: "Gespeichert", en: "Saves", tr: "Kaydetme", desc: { de: "Wie oft der Beitrag gespeichert wurde.", en: "How often the post was saved.", tr: "Gönderinin kaydedilme sayısı." } },
  shares: { de: "Geteilt", en: "Shares", tr: "Paylaşım", desc: { de: "Wie oft der Beitrag geteilt wurde.", en: "How often the post was shared.", tr: "Gönderinin paylaşılma sayısı." } },
  engagement_rate: { de: "Interaktionsrate", en: "Engagement rate", tr: "Etkileşim oranı", desc: { de: "(Likes + Kommentare + Gespeichert + Geteilt) ÷ Reichweite. Nur wenn Reichweite verfügbar ist.", en: "(Likes + comments + saves + shares) ÷ reach. Only when reach is available.", tr: "(Beğeni + yorum + kaydetme + paylaşım) ÷ erişim. Yalnızca erişim varsa." } },
} as const;
export type MetricKey = keyof typeof METRICS;
const POST_METRICS = ["reach", "views", "likes", "comments", "saves", "shares"] as const;

export async function seedMetricDefinitions(db: Db) {
  for (const [key, m] of Object.entries(METRICS))
    await db.insert(schema.metricDefinitions).values({ key, label: { de: m.de, en: m.en, tr: m.tr }, description: m.desc, unit: key === "engagement_rate" ? "percent" : "count" }).onConflictDoNothing();
}

// ── Collection ──
async function store(db: Db, rows: { organizationId: string; workspaceId: string; channelId: string; publishedPostId?: string; platform: Platform; metrics: Record<string, number | null>; at: Date }) {
  const values = Object.entries(rows.metrics).map(([metricKey, v]) => ({
    organizationId: rows.organizationId,
    workspaceId: rows.workspaceId,
    channelId: rows.channelId,
    publishedPostId: rows.publishedPostId ?? null,
    metricKey,
    value: v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v),
    available: v !== null && v !== undefined,
    sourcePlatform: rows.platform,
    collectedAt: rows.at,
  }));
  if (values.length) await db.insert(schema.analyticsSnapshots).values(values);
}

export async function collectPostInsights(deps: { db: Db; ring: Keyring; registry: AdapterRegistry }, publishedPostId: string, now = new Date()) {
  const [pp] = await deps.db.select().from(schema.publishedPosts).where(eq(schema.publishedPosts.id, publishedPostId));
  if (!pp) return { skipped: "not_found" };
  const state = await effectiveCapability(deps.db, pp.platform, pp.channelId, "insights.post");
  if (state === "unsupported" || state === "requires_manual_notification") return { skipped: `capability_${state}` };
  const { channel, auth } = await getChannelAuthForPublish(deps.db, deps.ring, pp.channelId);
  const metrics = await deps.registry.get(channel.platform).fetchInsights(auth, pp.externalPostId);
  await store(deps.db, { organizationId: pp.organizationId, workspaceId: pp.workspaceId, channelId: pp.channelId, publishedPostId: pp.id, platform: pp.platform, metrics, at: now });
  return { stored: Object.keys(metrics).length };
}

export async function collectAccountInsights(deps: { db: Db; ring: Keyring; registry: AdapterRegistry }, channelId: string, now = new Date()) {
  const { channel, auth } = await getChannelAuthForPublish(deps.db, deps.ring, channelId);
  const adapter = deps.registry.get(channel.platform);
  if (!adapter.fetchAccountInsights) return { skipped: "no_account_insights" };
  const metrics = await adapter.fetchAccountInsights(auth);
  await store(deps.db, { organizationId: channel.organizationId, workspaceId: channel.workspaceId, channelId, platform: channel.platform, metrics, at: now });
  return { stored: Object.keys(metrics).length };
}

/** Enqueues collection: posts published in the last 30 days every 6h, account metrics once a day (dedup). */
export async function scheduleInsightCollection(db: Db, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 864e5);
  const posts = await db.select({ id: schema.publishedPosts.id, org: schema.publishedPosts.organizationId }).from(schema.publishedPosts).where(gte(schema.publishedPosts.publishedAt, since));
  const slot6h = Math.floor(now.getTime() / (6 * 3600_000));
  for (const p of posts) await enqueue(db, { kind: "collect_insights", organizationId: p.org, payload: { publishedPostId: p.id }, dedupKey: `ins:p:${p.id}:${slot6h}`, maxAttempts: 3 });
  const channels = await db.select({ id: schema.channels.id, org: schema.channels.organizationId }).from(schema.channels).where(and(eq(schema.channels.status, "active"), isNull(schema.channels.disconnectedAt), eq(schema.channels.isSandbox, false)));
  const day = now.toISOString().slice(0, 10);
  for (const c of channels) await enqueue(db, { kind: "collect_insights", organizationId: c.org, payload: { channelId: c.id }, dedupKey: `ins:c:${c.id}:${day}`, maxAttempts: 3 });
  return { posts: posts.length, channels: channels.length };
}

// ── Reading ──
export type MetricValue = { value: number | null; status: "ok" | "not_available" | "not_collected"; collectedAt?: Date };
export type PostInsight = { publishedPostId: string; postId: string; channelId: string; platform: Platform; type: string; caption: string; publishedAt: Date; permalink: string | null; tags: string[]; metrics: Record<string, MetricValue> };

function latestPerMetric(rows: { metricKey: string; value: number | null; available: boolean; collectedAt: Date }[]) {
  const out: Record<string, MetricValue> = {};
  for (const r of [...rows].sort((a, b) => b.collectedAt.getTime() - a.collectedAt.getTime())) {
    if (out[r.metricKey]) continue;
    out[r.metricKey] = r.available ? { value: r.value, status: "ok", collectedAt: r.collectedAt } : { value: null, status: "not_available", collectedAt: r.collectedAt };
  }
  return out;
}

function withEngagement(m: Record<string, MetricValue>): Record<string, MetricValue> {
  const reach = m.reach;
  const parts = ["likes", "comments", "saves", "shares"].map((k) => m[k]);
  if (reach?.status === "ok" && reach.value && parts.some((p) => p?.status === "ok")) {
    const sum = parts.reduce((s, p) => s + (p?.status === "ok" ? (p.value ?? 0) : 0), 0);
    m.engagement_rate = { value: Math.round((sum / reach.value) * 10000) / 100, status: "ok" };
  } else m.engagement_rate = { value: null, status: reach ? "not_available" : "not_collected" };
  for (const k of POST_METRICS) m[k] ??= { value: null, status: "not_collected" };
  return m;
}

export async function listPostInsights(db: Db, actor: Actor, p: { workspaceId: string; from: Date; to: Date; channelIds?: string[]; tag?: string }): Promise<PostInsight[]> {
  await loadWorkspace(db, actor, p.workspaceId, "analytics.read");
  const pubs = await db
    .select({ pp: schema.publishedPosts, post: schema.posts })
    .from(schema.publishedPosts)
    .innerJoin(schema.postTargets, eq(schema.postTargets.id, schema.publishedPosts.postTargetId))
    .innerJoin(schema.posts, eq(schema.posts.id, schema.postTargets.postId))
    .where(
      and(
        eq(schema.publishedPosts.workspaceId, p.workspaceId),
        eq(schema.publishedPosts.organizationId, actor.organizationId),
        gte(schema.publishedPosts.publishedAt, p.from),
        lte(schema.publishedPosts.publishedAt, p.to),
        p.channelIds?.length ? inArray(schema.publishedPosts.channelId, p.channelIds) : undefined,
      ),
    )
    .orderBy(desc(schema.publishedPosts.publishedAt));
  const filtered = pubs.filter((r) => !p.tag || r.post.tags.includes(p.tag));
  const ids = filtered.map((r) => r.pp.id);
  const snaps = ids.length ? await db.select().from(schema.analyticsSnapshots).where(inArray(schema.analyticsSnapshots.publishedPostId, ids)) : [];
  return filtered.map(({ pp, post }) => ({
    publishedPostId: pp.id,
    postId: post.id,
    channelId: pp.channelId,
    platform: pp.platform,
    type: post.type,
    caption: post.caption,
    publishedAt: pp.publishedAt,
    permalink: pp.permalink,
    tags: post.tags,
    metrics: withEngagement(latestPerMetric(snaps.filter((s) => s.publishedPostId === pp.id))),
  }));
}

/** Sum of a metric over posts; N/A when no post has the metric available. */
function total(posts: PostInsight[], key: string): MetricValue {
  const ok = posts.map((x) => x.metrics[key]).filter((m): m is MetricValue => m?.status === "ok");
  if (!ok.length) return { value: null, status: posts.length ? "not_available" : "not_collected" };
  return { value: ok.reduce((s, m) => s + (m.value ?? 0), 0), status: "ok" };
}

export async function getInsightsOverview(db: Db, actor: Actor, p: { workspaceId: string; from: Date; to: Date; channelIds?: string[]; tag?: string }) {
  const span = p.to.getTime() - p.from.getTime();
  const prevFrom = new Date(p.from.getTime() - span);
  const [cur, prev] = await Promise.all([listPostInsights(db, actor, p), listPostInsights(db, actor, { ...p, from: prevFrom, to: p.from })]);
  const keys = ["reach", "views", "likes", "comments", "saves", "shares"];
  const summary: Record<string, { current: MetricValue; previous: MetricValue; deltaPct: number | null }> = {};
  for (const k of keys) {
    const c = total(cur, k);
    const pr = total(prev, k);
    summary[k] = { current: c, previous: pr, deltaPct: c.status === "ok" && pr.status === "ok" && pr.value ? Math.round(((c.value! - pr.value) / pr.value) * 1000) / 10 : null };
  }
  const eng = withEngagement({ reach: summary.reach!.current, likes: summary.likes!.current, comments: summary.comments!.current, saves: summary.saves!.current, shares: summary.shares!.current });
  summary.engagement_rate = { current: eng.engagement_rate!, previous: { value: null, status: "not_collected" }, deltaPct: null };

  // Account metrics: latest snapshot per channel (followers + growth within the period).
  const channels = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.workspaceId, p.workspaceId), eq(schema.channels.organizationId, actor.organizationId), isNull(schema.channels.disconnectedAt), p.channelIds?.length ? inArray(schema.channels.id, p.channelIds) : undefined));
  const accSnaps = channels.length
    ? await db
        .select()
        .from(schema.analyticsSnapshots)
        .where(and(inArray(schema.analyticsSnapshots.channelId, channels.map((c) => c.id)), isNull(schema.analyticsSnapshots.publishedPostId), lte(schema.analyticsSnapshots.collectedAt, p.to)))
    : [];
  const accounts = await Promise.all(
    channels.map(async (c) => {
      const mine = accSnaps.filter((s) => s.channelId === c.id && s.metricKey === "followers" && s.available).sort((a, b) => a.collectedAt.getTime() - b.collectedAt.getTime());
      const inPeriod = mine.filter((s) => s.collectedAt >= p.from);
      const last = mine.at(-1);
      const first = inPeriod[0];
      return {
        channelId: c.id,
        name: c.displayName,
        platform: c.platform,
        sandbox: c.isSandbox,
        insightsCapability: await effectiveCapability(db, c.platform, c.id, "insights.account"),
        followers: last ? ({ value: last.value, status: "ok", collectedAt: last.collectedAt } as MetricValue) : ({ value: null, status: "not_collected" } as MetricValue),
        followerGrowth: first && last && first !== last ? (last.value ?? 0) - (first.value ?? 0) : null,
        posts: cur.filter((x) => x.channelId === c.id).length,
      };
    }),
  );
  return { range: { from: p.from, to: p.to, previousFrom: prevFrom }, sampleSize: cur.length, summary, accounts, posts: cur };
}

// ── Takeaways: evidence-based, deterministic; the AI layer may rephrase but never invents numbers ──
export type Takeaway = { kind: "best_weekday" | "best_hour" | "best_type" | "top_post" | "insufficient_data"; text: Record<"de" | "en" | "tr", string>; evidence: { sample: number; metric: string; from: string; to: string } };
const WD = { de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"], en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], tr: ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"] };

export function computeTakeaways(posts: PostInsight[], timeZone: string, range: { from: Date; to: Date }, minSample = 5): Takeaway[] {
  const scored = posts
    .map((x) => {
      const er = x.metrics.engagement_rate;
      const inter = ["likes", "comments", "saves", "shares"].reduce((s, k) => s + (x.metrics[k]?.status === "ok" ? (x.metrics[k]!.value ?? 0) : 0), 0);
      return { x, score: er?.status === "ok" ? er.value! : null, inter };
    })
    .filter((s) => s.x.metrics.likes?.status === "ok" || s.score !== null);
  const metric = scored.every((s) => s.score !== null) ? "engagement_rate" : "interactions";
  const val = (s: (typeof scored)[number]) => (metric === "engagement_rate" ? s.score! : s.inter);
  const ev = { sample: scored.length, metric, from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10) };
  if (scored.length < minSample)
    return [{ kind: "insufficient_data", text: { de: `Zu wenig Daten für belastbare Aussagen (${scored.length} von mind. ${minSample} Beiträgen mit Metriken).`, en: `Not enough data for reliable takeaways (${scored.length} of at least ${minSample} posts with metrics).`, tr: `Güvenilir çıkarım için yetersiz veri (en az ${minSample} gönderiden ${scored.length} tanesinde metrik var).` }, evidence: ev }];
  const groupBest = <K extends string | number>(key: (s: (typeof scored)[number]) => K) => {
    const g = new Map<K, number[]>();
    for (const s of scored) g.set(key(s), [...(g.get(key(s)) ?? []), val(s)]);
    const avg = [...g.entries()].filter(([, v]) => v.length >= 2).map(([k, v]) => ({ k, avg: v.reduce((a, b) => a + b, 0) / v.length, n: v.length }));
    const overall = scored.reduce((a, s) => a + val(s), 0) / scored.length;
    const best = avg.sort((a, b) => b.avg - a.avg)[0];
    return best && overall > 0 ? { ...best, lift: Math.round(((best.avg - overall) / overall) * 100) } : null;
  };
  const out: Takeaway[] = [];
  const wd = groupBest((s) => {
    const w = utcToWallClock(s.x.publishedAt, timeZone);
    return ((new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay() + 6) % 7) as number;
  });
  if (wd && wd.lift > 0)
    out.push({ kind: "best_weekday", text: { de: `Beiträge am ${WD.de[wd.k]} erzielen ${wd.lift} % mehr ${metric === "engagement_rate" ? "Interaktionsrate" : "Interaktionen"} als der Durchschnitt (${wd.n} Beiträge).`, en: `Posts on ${WD.en[wd.k]} get ${wd.lift}% more ${metric === "engagement_rate" ? "engagement rate" : "interactions"} than average (${wd.n} posts).`, tr: `${WD.tr[wd.k]} günü gönderileri ortalamadan %${wd.lift} daha fazla ${metric === "engagement_rate" ? "etkileşim oranı" : "etkileşim"} alıyor (${wd.n} gönderi).` }, evidence: ev });
  const hr = groupBest((s) => {
    const h = utcToWallClock(s.x.publishedAt, timeZone).hour;
    return h < 11 ? "morning" : h < 15 ? "midday" : h < 19 ? "afternoon" : "evening";
  });
  const HR = { de: { morning: "morgens", midday: "mittags", afternoon: "nachmittags", evening: "abends" }, en: { morning: "in the morning", midday: "at midday", afternoon: "in the afternoon", evening: "in the evening" }, tr: { morning: "sabah", midday: "öğle", afternoon: "öğleden sonra", evening: "akşam" } };
  if (hr && hr.lift > 0) out.push({ kind: "best_hour", text: { de: `Veröffentlichungen ${HR.de[hr.k]} schneiden ${hr.lift} % besser ab (${hr.n} Beiträge).`, en: `Posts published ${HR.en[hr.k]} perform ${hr.lift}% better (${hr.n} posts).`, tr: `${HR.tr[hr.k]} yayınlanan gönderiler %${hr.lift} daha iyi performans gösteriyor (${hr.n} gönderi).` }, evidence: ev });
  const ty = groupBest((s) => s.x.type);
  if (ty && ty.lift > 0) out.push({ kind: "best_type", text: { de: `Format „${ty.k}“ liegt ${ty.lift} % über dem Durchschnitt (${ty.n} Beiträge).`, en: `Format "${ty.k}" is ${ty.lift}% above average (${ty.n} posts).`, tr: `"${ty.k}" formatı ortalamanın %${ty.lift} üzerinde (${ty.n} gönderi).` }, evidence: ev });
  const top = [...scored].sort((a, b) => val(b) - val(a))[0]!;
  out.push({ kind: "top_post", text: { de: `Stärkster Beitrag: „${top.x.caption.slice(0, 60)}…“.`, en: `Top post: "${top.x.caption.slice(0, 60)}…".`, tr: `En güçlü gönderi: "${top.x.caption.slice(0, 60)}…".` }, evidence: ev });
  return out;
}

export async function seriesByDay(db: Db, actor: Actor, p: { workspaceId: string; from: Date; to: Date; channelIds?: string[]; metric: string; timeZone: string }) {
  const posts = await listPostInsights(db, actor, p);
  const map = new Map<string, number>();
  let any = false;
  for (const x of posts) {
    const m = x.metrics[p.metric];
    const w = utcToWallClock(x.publishedAt, p.timeZone);
    const key = `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
    if (m?.status === "ok") {
      any = true;
      map.set(key, (map.get(key) ?? 0) + (m.value ?? 0));
    }
  }
  return any ? [...map.entries()].sort().map(([day, value]) => ({ day, value })) : null;
}

