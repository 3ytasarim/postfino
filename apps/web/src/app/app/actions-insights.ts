"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, gte, isNull, schema } from "@sichttakt/db";
import {
  enqueue,
  replyToComment,
  setThreadStatus,
  commentToIdea,
  saveSavedReply,
  deleteSavedReply,
  createReport,
  authorize,
  isAppError,
  type ReportConfig,
} from "@sichttakt/core";
import { requireContext } from "@/lib/server";
import type { ActionResult } from "./actions";

function fail(e: unknown): ActionResult {
  if (isAppError(e)) return { error: e.message, details: e.details };
  throw e;
}

/** Queues metric collection for this workspace (published posts of the last 30 days + its accounts). */
export async function collectInsightsNowAction(): Promise<ActionResult> {
  const ctx = await requireContext();
  authorize(ctx.actor, ctx.workspace.id, "analytics.read");
  const since = new Date(Date.now() - 30 * 864e5);
  const posts = await ctx.svc.db.select({ id: schema.publishedPosts.id }).from(schema.publishedPosts).where(and(eq(schema.publishedPosts.workspaceId, ctx.workspace.id), gte(schema.publishedPosts.publishedAt, since)));
  const channels = await ctx.svc.db.select({ id: schema.channels.id }).from(schema.channels).where(and(eq(schema.channels.workspaceId, ctx.workspace.id), eq(schema.channels.status, "active"), isNull(schema.channels.disconnectedAt)));
  const slot = Math.floor(Date.now() / 600_000); // at most once per 10 min
  for (const p of posts) await enqueue(ctx.svc.db, { kind: "collect_insights", organizationId: ctx.organization.id, payload: { publishedPostId: p.id }, dedupKey: `ins:manual:p:${p.id}:${slot}` });
  for (const c of channels) await enqueue(ctx.svc.db, { kind: "collect_insights", organizationId: ctx.organization.id, payload: { channelId: c.id }, dedupKey: `ins:manual:c:${c.id}:${slot}` });
  return { ok: true, details: { posts: posts.length, channels: channels.length } };
}

export async function syncCommentsNowAction(): Promise<ActionResult> {
  const ctx = await requireContext();
  authorize(ctx.actor, ctx.workspace.id, "analytics.read");
  const since = new Date(Date.now() - 14 * 864e5);
  const posts = await ctx.svc.db.select({ id: schema.publishedPosts.id }).from(schema.publishedPosts).where(and(eq(schema.publishedPosts.workspaceId, ctx.workspace.id), gte(schema.publishedPosts.publishedAt, since)));
  const slot = Math.floor(Date.now() / 300_000);
  for (const p of posts) await enqueue(ctx.svc.db, { kind: "sync_comments", organizationId: ctx.organization.id, payload: { publishedPostId: p.id }, dedupKey: `cm:manual:${p.id}:${slot}` });
  return { ok: true, details: { posts: posts.length } };
}

export async function replyCommentAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await replyToComment(ctx.svc, ctx.actor, String(fd.get("commentId")), String(fd.get("text") ?? ""));
    revalidatePath("/app/community");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function threadStatusAction(fd: FormData) {
  const ctx = await requireContext();
  await setThreadStatus(ctx.svc.db, ctx.actor, String(fd.get("threadId")), fd.get("status") === "resolved" ? "resolved" : "open");
  revalidatePath("/app/community");
}

export async function commentToIdeaAction(fd: FormData) {
  const ctx = await requireContext();
  const idea = await commentToIdea(ctx.svc.db, ctx.actor, String(fd.get("commentId")));
  redirect(idea ? `/app/ideas?tab=board&idea=${idea.id}` : "/app/ideas");
}

export async function saveSavedReplyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await saveSavedReply(ctx.svc.db, ctx.actor, ctx.workspace.id, { title: String(fd.get("title") ?? ""), body: String(fd.get("body") ?? "") });
    revalidatePath("/app/community");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteSavedReplyAction(fd: FormData) {
  const ctx = await requireContext();
  await deleteSavedReply(ctx.svc.db, ctx.actor, String(fd.get("id")));
  revalidatePath("/app/community");
}

export async function createReportAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const format = String(fd.get("format")) as "pdf" | "csv" | "md";
  const day = (v: FormDataEntryValue | null, end = false) => `${String(v ?? "")}T${end ? "23:59:59" : "00:00:00"}Z`;
  const cfg: ReportConfig = {
    from: day(fd.get("from")),
    to: day(fd.get("to"), true),
    locale: ["de", "en", "tr"].includes(String(fd.get("locale"))) ? (String(fd.get("locale")) as "de") : "de",
    logoAssetId: String(fd.get("logoAssetId") ?? "") || undefined,
    footer: String(fd.get("footer") ?? "").slice(0, 120) || undefined,
    includeTakeaways: fd.get("takeaways") === "on",
  };
  try {
    await createReport(ctx.svc.db, ctx.actor, { workspaceId: ctx.workspace.id, title: String(fd.get("title") ?? ""), format, config: cfg });
    revalidatePath("/app/reports");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
