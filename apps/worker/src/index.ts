import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { claimJobs, completeJob, createServices, deliverWebhook, failJob, processPublishJob, processRefreshJob, scheduleTokenRefreshes, fetchFeed, scheduleFeedFetches, sendApprovalReminders, collectPostInsights, collectAccountInsights, scheduleInsightCollection, syncComments, scheduleCommentSync, processReportJob, recordHeartbeat, type Job } from "@sichttakt/core";

// Worker process: polls the Postgres queue. Safe to run N instances (SKIP LOCKED + leases).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const svc = createServices({ root, maxConnections: 5 });
const workerId = `${os.hostname()}:${process.pid}`;
let stopping = false;

async function handle(job: Job) {
  if (job.kind === "publish_target") {
    const outcome = await processPublishJob({ db: svc.db, ring: svc.ring, registry: svc.registry, storage: svc.storage, mediaUrlTtlSeconds: svc.config.MEDIA_URL_TTL_SECONDS }, job);
    console.log(`[worker] publish ${job.id} → ${outcome}`);
  } else if (job.kind === "deliver_webhook") {
    const r = await deliverWebhook(svc.db, svc.ring, String(job.payload.deliveryId), fetch, svc.config.NODE_ENV !== "production");
    if (r.ok) await completeJob(svc.db, job.id);
    else await failJob(svc.db, job, r.error ?? "delivery failed", { retryable: r.retryable });
  } else if (job.kind === "fetch_rss") {
    const r = await fetchFeed(svc.db, String(job.payload.feedId), { allowPrivate: svc.config.NODE_ENV !== "production" });
    console.log(`[worker] rss ${job.payload.feedId} → ${JSON.stringify(r)}`);
    await completeJob(svc.db, job.id);
  } else if (job.kind === "collect_insights") {
    const r = job.payload.publishedPostId ? await collectPostInsights(svc, String(job.payload.publishedPostId)) : await collectAccountInsights(svc, String(job.payload.channelId));
    console.log(`[worker] insights ${job.id} → ${JSON.stringify(r)}`);
    await completeJob(svc.db, job.id);
  } else if (job.kind === "sync_comments") {
    const r = await syncComments(svc, String(job.payload.publishedPostId));
    if (r.added) console.log(`[worker] comments ${job.payload.publishedPostId} +${r.added}`);
    await completeJob(svc.db, job.id);
  } else if (job.kind === "generate_report") {
    await processReportJob(svc, String(job.payload.reportId));
    console.log(`[worker] report ${job.payload.reportId} ready`);
    await completeJob(svc.db, job.id);
  } else if (job.kind === "refresh_token") {
    console.log(`[worker] refresh ${job.id} → ${await processRefreshJob(svc, job)}`);
  } else {
    await failJob(svc.db, job, `unknown job kind ${job.kind}`, { retryable: false });
  }
}

let lastSchedule = 0;
let lastRss = 0;
let lastInsights = 0;
let lastBeat = 0;
async function loop() {
  while (!stopping) {
    if (Date.now() - lastSchedule > 3600_000) {
      lastSchedule = Date.now();
      await scheduleTokenRefreshes(svc.db).then((r) => r.queued && console.log(`[worker] token refresh queued: ${r.queued}`)).catch((e) => console.error("[worker] schedule error", e));
    }
    if (Date.now() - lastRss > 30 * 60_000) {
      lastRss = Date.now();
      await scheduleFeedFetches(svc.db).catch((e) => console.error("[worker] rss schedule error", e));
      await scheduleCommentSync(svc.db).catch((e) => console.error("[worker] comment sync schedule error", e));
      await sendApprovalReminders(svc.db, svc.mailer, svc.config.APP_URL).then((n) => n && console.log(`[worker] approval reminders: ${n}`)).catch((e) => console.error("[worker] reminder error", e));
    }
    if (Date.now() - lastBeat > 30_000) {
      lastBeat = Date.now();
      await recordHeartbeat(svc.db, workerId, "worker", { version: "0.1.0" }).catch(() => {});
    }
    if (Date.now() - lastInsights > 6 * 3600_000) {
      lastInsights = Date.now();
      await scheduleInsightCollection(svc.db).catch((e) => console.error("[worker] insights schedule error", e));
    }
    let jobs: Job[] = [];
    try {
      jobs = await claimJobs(svc.db, workerId, { limit: 5, leaseSeconds: 15 * 60 });
      for (const job of jobs) {
        try {
          await handle(job);
        } catch (e) {
          console.error(`[worker] job ${job.id} crashed`, e);
          await failJob(svc.db, job, (e as Error).message, { retryable: true });
        }
      }
    } catch (e) {
      console.error("[worker] poll error", e);
    }
    if (jobs.length === 0) await new Promise((r) => setTimeout(r, svc.config.WORKER_POLL_MS));
  }
  await svc.close();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stopping = true));
console.log(`[worker] ${workerId} started`);
await loop();
