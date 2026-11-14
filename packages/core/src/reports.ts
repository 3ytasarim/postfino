import { and, desc, eq, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import { loadWorkspace } from "./tenancy";
import { getEntitlements } from "./entitlements";
import { getInsightsOverview, computeTakeaways, METRICS, type MetricValue } from "./insights";
import { communityStats } from "./community";
import { toCsv } from "./csv";
import { writeZip } from "./zip";
import { PdfDoc, wrap } from "./pdf";
import { probe } from "./media-probe";
import { enqueue } from "./queue";
import { audit } from "./audit";
import type { StorageDriver } from "./storage";
import type { Actor } from "./rbac";

// Reports: CSV (ZIP of summary / posts / timeseries), Markdown, PDF. Branded PDF (logo + own
// title) is an Agency+ feature. Generation runs in the worker; N/A stays N/A in every format.

export type ReportFormat = "pdf" | "csv" | "md";
export type ReportConfig = { from: string; to: string; channelIds?: string[]; tag?: string; locale?: "de" | "en" | "tr"; logoAssetId?: string; footer?: string; includeTakeaways?: boolean };

export async function createReport(db: Db, actor: Actor, p: { workspaceId: string; title: string; format: ReportFormat; config: ReportConfig }) {
  await loadWorkspace(db, actor, p.workspaceId, "reports.write");
  if (!["pdf", "csv", "md"].includes(p.format)) throw new AppError("VALIDATION_FAILED", "Unknown format");
  const from = new Date(p.config.from);
  const to = new Date(p.config.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new AppError("VALIDATION_FAILED", "Invalid date range");
  if (to.getTime() - from.getTime() > 366 * 864e5) throw new AppError("VALIDATION_FAILED", "Max. 1 year per report");
  if (p.config.logoAssetId) {
    const ent = await getEntitlements(db, actor.organizationId);
    if (!ent.features.has("branded_reports")) throw new AppError("PLAN_FEATURE_UNAVAILABLE", "Branded reports are included from the Agency plan");
  }
  const [r] = await db
    .insert(schema.reports)
    .values({ organizationId: actor.organizationId, workspaceId: p.workspaceId, title: p.title.trim().slice(0, 140) || "Bericht", format: p.format, config: p.config, createdByUserId: actor.kind === "user" ? actor.userId : null })
    .returning();
  await enqueue(db, { kind: "generate_report", organizationId: actor.organizationId, payload: { reportId: r!.id }, dedupKey: `report:${r!.id}`, maxAttempts: 2 });
  await audit(db, { organizationId: actor.organizationId, workspaceId: p.workspaceId, actor, action: "report.requested", targetType: "report", targetId: r!.id, metadata: { format: p.format } });
  return r!;
}

export async function listReports(db: Db, actor: Actor, workspaceId: string) {
  await loadWorkspace(db, actor, workspaceId, "analytics.read");
  return db.select().from(schema.reports).where(eq(schema.reports.workspaceId, workspaceId)).orderBy(desc(schema.reports.createdAt)).limit(50);
}

export async function getReportFile(db: Db, storage: StorageDriver, actor: Actor, reportId: string) {
  const [r] = await db.select().from(schema.reports).where(and(eq(schema.reports.id, reportId), eq(schema.reports.organizationId, actor.organizationId)));
  if (!r) throw new AppError("NOT_FOUND", "Report not found");
  await loadWorkspace(db, actor, r.workspaceId, "analytics.read");
  if (r.status !== "ready" || !r.storageKey) throw new AppError("CONFLICT", `Report is ${r.status}`);
  const ext = r.format === "csv" ? "zip" : r.format;
  const type = { pdf: "application/pdf", zip: "application/zip", md: "text/markdown; charset=utf-8" }[ext]!;
  return { data: await storage.get(r.storageKey), contentType: type, filename: `${r.title.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60)}.${ext}` };
}

const L = {
  de: { range: "Zeitraum", prev: "Vorzeitraum", posts: "Beiträge", accounts: "Konten", followers: "Follower", growth: "Zuwachs", takeaways: "Erkenntnisse", na: "N/A", notCollected: "nicht erhoben", community: "Community", received: "Kommentare erhalten", replied: "beantwortet", median: "Median Antwortzeit (Min.)", generated: "Erstellt mit SichtTakt", sample: "Stichprobe", definitions: "Metrik-Definitionen", sandbox: "Sandbox (MOCK)" },
  en: { range: "Period", prev: "Previous period", posts: "Posts", accounts: "Accounts", followers: "Followers", growth: "Growth", takeaways: "Takeaways", na: "N/A", notCollected: "not collected", community: "Community", received: "Comments received", replied: "replied", median: "Median response time (min)", generated: "Generated with SichtTakt", sample: "Sample", definitions: "Metric definitions", sandbox: "Sandbox (MOCK)" },
  tr: { range: "Dönem", prev: "Önceki dönem", posts: "Gönderiler", accounts: "Hesaplar", followers: "Takipçi", growth: "Artış", takeaways: "Çıkarımlar", na: "Yok (N/A)", notCollected: "toplanmadı", community: "Topluluk", received: "Gelen yorum", replied: "yanıtlanan", median: "Medyan yanıt süresi (dk)", generated: "SichtTakt ile oluşturuldu", sample: "Örneklem", definitions: "Metrik tanımları", sandbox: "Sandbox (MOCK)" },
};

/** Worker: renders and stores the report file. */
export async function processReportJob(deps: { db: Db; storage: StorageDriver }, reportId: string) {
  const { db, storage } = deps;
  const [r] = await db.select().from(schema.reports).where(eq(schema.reports.id, reportId));
  if (!r || r.status === "ready") return;
  await db.update(schema.reports).set({ status: "running" }).where(eq(schema.reports.id, r.id));
  try {
    const cfg = r.config as ReportConfig;
    const actor: Actor = { kind: "system", organizationId: r.organizationId };
    const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, r.workspaceId));
    const loc = cfg.locale ?? "de";
    const t = L[loc];
    const from = new Date(cfg.from);
    const to = new Date(cfg.to);
    const ov = await getInsightsOverview(db, actor, { workspaceId: r.workspaceId, from, to, channelIds: cfg.channelIds, tag: cfg.tag });
    const takeaways = cfg.includeTakeaways === false ? [] : computeTakeaways(ov.posts, ws!.timezone, { from, to });
    const cm = await communityStats(db, actor, { workspaceId: r.workspaceId, from, to });
    const fmtV = (m: MetricValue | undefined, pct = false) => (!m || m.status === "not_collected" ? t.notCollected : m.status === "not_available" ? t.na : `${m.value!.toLocaleString(loc)}${pct ? " %" : ""}`);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const label = (k: string) => METRICS[k as keyof typeof METRICS]?.[loc] ?? k;
    let data: Buffer;
    let ext: string;

    if (r.format === "csv") {
      const summary = toCsv([["metric", "current", "previous", "delta_pct", "status"], ...Object.entries(ov.summary).map(([k, v]) => [k, v.current.value, v.previous.value, v.deltaPct, v.current.status])]);
      const posts = toCsv([
        ["published_at", "channel_id", "platform", "type", "caption", "permalink", "tags", ...["reach", "views", "likes", "comments", "saves", "shares", "engagement_rate"].map((k) => k)],
        ...ov.posts.map((x) => [x.publishedAt.toISOString(), x.channelId, x.platform, x.type, x.caption.slice(0, 500), x.permalink, x.tags.join("|"), ...["reach", "views", "likes", "comments", "saves", "shares", "engagement_rate"].map((k) => (x.metrics[k]?.status === "ok" ? x.metrics[k]!.value : "N/A"))]),
      ]);
      const accounts = toCsv([["channel", "platform", "followers", "follower_growth", "posts"], ...ov.accounts.map((a) => [a.name, a.platform, a.followers.value ?? "N/A", a.followerGrowth ?? "", a.posts])]);
      data = writeZip({ "summary.csv": Buffer.from(summary), "posts.csv": Buffer.from(posts), "accounts.csv": Buffer.from(accounts) }, { deflate: true });
      ext = "zip";
    } else if (r.format === "md") {
      const md = [
        `# ${r.title}`,
        `**${ws!.name}** · ${t.range}: ${day(from)} – ${day(to)} · ${t.prev}: ${day(ov.range.previousFrom)} – ${day(from)}`,
        "",
        `| | ${t.range} | ${t.prev} | Δ |`,
        "|---|---:|---:|---:|",
        ...Object.entries(ov.summary).map(([k, v]) => `| ${label(k)} | ${fmtV(v.current, k === "engagement_rate")} | ${fmtV(v.previous, k === "engagement_rate")} | ${v.deltaPct === null ? "–" : `${v.deltaPct > 0 ? "+" : ""}${v.deltaPct} %`} |`),
        "",
        `## ${t.accounts}`,
        ...ov.accounts.map((a) => `- ${a.name} (${a.platform}${a.sandbox ? `, ${t.sandbox}` : ""}): ${t.followers} ${fmtV(a.followers)}${a.followerGrowth !== null ? `, ${t.growth} ${a.followerGrowth}` : ""} · ${t.posts}: ${a.posts}`),
        "",
        `## ${t.community}`,
        `${t.received}: ${cm.received} · ${t.replied}: ${cm.replied}${cm.replyRate !== null ? ` (${cm.replyRate} %)` : ""} · ${t.median}: ${cm.medianResponseMinutes ?? "–"}`,
        "",
        ...(takeaways.length ? [`## ${t.takeaways}`, ...takeaways.map((x) => `- ${x.text[loc]}`), `_${t.sample}: ${takeaways[0]!.evidence.sample}_`, ""] : []),
        `## ${t.posts}`,
        "| Datum | Typ | Text | Reichweite | Likes | Kommentare |",
        "|---|---|---|---:|---:|---:|",
        ...ov.posts.map((x) => `| ${day(x.publishedAt)} | ${x.type} | ${x.caption.slice(0, 60).replace(/\|/g, "/").replace(/\n/g, " ")} | ${fmtV(x.metrics.reach)} | ${fmtV(x.metrics.likes)} | ${fmtV(x.metrics.comments)} |`),
        "",
        `## ${t.definitions}`,
        ...Object.entries(METRICS).map(([, m]) => `- **${m[loc]}**: ${m.desc[loc]}`),
        "",
        `_${t.generated}${cfg.footer ? ` · ${cfg.footer}` : ""}_`,
      ].join("\n");
      data = Buffer.from(md, "utf8");
      ext = "md";
    } else {
      const doc = new PdfDoc();
      const M = 48;
      let y = 56;
      const ensure = (h: number) => {
        if (y + h > doc.height - 60) {
          doc.addPage();
          y = 56;
        }
      };
      if (cfg.logoAssetId) {
        const [logo] = await db.select().from(schema.mediaAssets).where(and(eq(schema.mediaAssets.id, cfg.logoAssetId), eq(schema.mediaAssets.organizationId, r.organizationId)));
        if (logo?.mimeType === "image/jpeg") {
          const buf = await storage.get(logo.storageKey);
          const pr = probe(buf);
          if (pr.kind === "image") {
            doc.setImage(buf, pr.width, pr.height);
            const h = 36;
            doc.drawImage(doc.width - M - (pr.width / pr.height) * h, 40, (pr.width / pr.height) * h, h);
          }
        }
      }
      doc.rect(M, y - 8, 6, 30, [0.91, 0.29, 0.11]);
      doc.text(M + 16, y + 14, r.title, { size: 20, bold: true });
      y += 36;
      doc.text(M + 16, y, `${ws!.name} · ${t.range}: ${day(from)} – ${day(to)}`, { size: 10, color: [0.3, 0.3, 0.34] });
      y += 30;
      // KPI grid
      const keys = ["reach", "views", "likes", "comments", "saves", "shares", "engagement_rate"];
      const colW = (doc.width - 2 * M) / 4;
      keys.forEach((k, i) => {
        const cx = M + (i % 4) * colW;
        const cy = y + Math.floor(i / 4) * 64;
        doc.rect(cx, cy, colW - 8, 56, [0.96, 0.96, 0.94]);
        doc.text(cx + 10, cy + 18, label(k), { size: 8, color: [0.35, 0.35, 0.38] });
        doc.text(cx + 10, cy + 40, fmtV(ov.summary[k]?.current, k === "engagement_rate"), { size: 15, bold: true });
        const d = ov.summary[k]?.deltaPct;
        if (d !== null && d !== undefined) doc.text(cx + 10, cy + 51, `${d > 0 ? "+" : ""}${d} % vs. ${t.prev}`, { size: 7, color: d >= 0 ? [0.06, 0.54, 0.28] : [0.78, 0.19, 0.18] });
      });
      y += 140;
      doc.text(M, y, t.accounts, { size: 12, bold: true });
      y += 16;
      for (const a of ov.accounts) {
        ensure(16);
        doc.text(M, y, `${a.name} (${a.platform}${a.sandbox ? `, ${t.sandbox}` : ""})`, { size: 9 });
        doc.text(M + 280, y, `${t.followers}: ${fmtV(a.followers)}${a.followerGrowth !== null ? ` (${a.followerGrowth >= 0 ? "+" : ""}${a.followerGrowth})` : ""} · ${t.posts}: ${a.posts}`, { size: 9 });
        y += 14;
      }
      y += 10;
      ensure(40);
      doc.text(M, y, t.community, { size: 12, bold: true });
      y += 16;
      doc.text(M, y, `${t.received}: ${cm.received} · ${t.replied}: ${cm.replied}${cm.replyRate !== null ? ` (${cm.replyRate} %)` : ""} · ${t.median}: ${cm.medianResponseMinutes ?? "–"}`, { size: 9 });
      y += 24;
      if (takeaways.length) {
        ensure(30);
        doc.text(M, y, t.takeaways, { size: 12, bold: true });
        y += 16;
        for (const x of takeaways)
          for (const ln of wrap(`• ${x.text[loc]}`, 9, doc.width - 2 * M)) {
            ensure(14);
            doc.text(M, y, ln, { size: 9 });
            y += 13;
          }
        doc.text(M, y, `${t.sample}: ${takeaways[0]!.evidence.sample}`, { size: 7, color: [0.45, 0.45, 0.48] });
        y += 20;
      }
      ensure(40);
      doc.text(M, y, t.posts, { size: 12, bold: true });
      y += 14;
      const cols = [M, M + 62, M + 110, M + 330, M + 390, M + 440];
      ["Datum", "Typ", "Text", label("reach"), label("likes"), label("comments")].forEach((h, i) => doc.text(cols[i]!, y, h, { size: 8, bold: true, color: [0.35, 0.35, 0.38] }));
      y += 6;
      doc.line(M, y, doc.width - M, y);
      y += 12;
      for (const x of ov.posts) {
        ensure(14);
        const cap = wrap(x.caption.replace(/\n/g, " "), 8, 210)[0] ?? "";
        [day(x.publishedAt), x.type, cap, fmtV(x.metrics.reach), fmtV(x.metrics.likes), fmtV(x.metrics.comments)].forEach((v, i) => doc.text(cols[i]!, y, v, { size: 8 }));
        y += 13;
      }
      ensure(30);
      y += 16;
      doc.text(M, y, `${t.generated}${cfg.footer ? ` · ${cfg.footer}` : ""} · N/A = ${loc === "de" ? "von der Plattform nicht bereitgestellt" : loc === "tr" ? "platform sağlamıyor" : "not provided by the platform"}`, { size: 7, color: [0.45, 0.45, 0.48] });
      data = doc.toBuffer({ title: r.title, author: ws!.name });
      ext = "pdf";
    }
    const key = `reports/${r.organizationId}/${r.id}.${ext}`;
    await storage.put(key, data, ext === "pdf" ? "application/pdf" : ext === "zip" ? "application/zip" : "text/markdown");
    await db.update(schema.reports).set({ status: "ready", storageKey: key, completedAt: new Date(), error: null }).where(eq(schema.reports.id, r.id));
  } catch (e) {
    await db.update(schema.reports).set({ status: "failed", error: (e as Error).message.slice(0, 500) }).where(eq(schema.reports.id, r.id));
    throw e;
  }
}
