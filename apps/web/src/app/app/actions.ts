"use server";
import { oauthRedirectUri } from "@sichttakt/config";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull, schema } from "@sichttakt/db";
import {
  beginConnect,
  upsertChannel,
  disconnectChannel,
  createApiKey,
  revokeApiKey,
  rotateApiKey,
  createWebhook,
  deleteWebhook,
  createPost,
  decideApproval,
  submitForApproval,
  requestPublish,
  cancelPost,
  setActiveContext,
  beginTotpSetup,
  confirmTotp,
  isAppError,
  authorize,
  inviteMember,
  changeMemberRole,
  removeMember,
  createEmailVerification,
  mailTemplates,
  reschedulePost,
  bulkShift,
  setSlots,
  shuffleQueue,
  setQueuePaused,
  clonePost,
  assignQueueSlots,
  replayDeadJob,
  bakeCoverIntoVideo,
  connectWithCredentials,
  createManualChannel,
  CONNECTABLE_PLATFORMS,
} from "@sichttakt/core";
import { API_SCOPES, ROLES, LOCALES, WEBHOOK_EVENTS, wallClockToUtc, parseLocalDateTime, NonexistentLocalTimeError, type ApiScope, type WebhookEvent, type Role, type Platform } from "@sichttakt/shared";
import { requireContext } from "@/lib/server";
import { LOCALE_COOKIE } from "@/i18n";

export type ActionResult = { ok?: boolean; error?: string; secret?: string; details?: unknown } | undefined;

function fail(e: unknown): ActionResult {
  if (isAppError(e)) return { error: e.message, details: e.details };
  throw e;
}

export async function switchWorkspaceAction(fd: FormData) {
  const ctx = await requireContext();
  const ws = ctx.workspaces.find((w) => w.id === fd.get("workspaceId"));
  if (ws) await setActiveContext(ctx.svc.db, ctx.session.token, { organizationId: ctx.organization.id, workspaceId: ws.id });
  revalidatePath("/app", "layout");
}

export async function setPreferenceAction(fd: FormData) {
  const jar = await cookies();
  const locale = String(fd.get("locale") ?? "");
  const theme = String(fd.get("theme") ?? "");
  if ((LOCALES as readonly string[]).includes(locale)) jar.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
  if (["light", "dark", "system"].includes(theme)) jar.set("st_theme", theme, { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
  revalidatePath("/", "layout");
}

// ── Channels ──
export async function connectSandboxAction() {
  const ctx = await requireContext();
  if (ctx.svc.config.SANDBOX_ENABLED !== "true") return;
  authorize(ctx.actor, ctx.workspace.id, "channels.connect");
  await upsertChannel(ctx.svc.db, ctx.svc.ring, {
    organizationId: ctx.organization.id,
    workspaceId: ctx.workspace.id,
    platform: "sandbox",
    isSandbox: true,
    userId: ctx.user.id,
    account: { externalId: `sandbox-${crypto.randomUUID().slice(0, 8)}`, displayName: "Sandbox Instagram (MOCK)", username: "sandbox", accessToken: "sandbox-token", grantedScopes: ["sandbox"], meta: { mock: true } },
  });
  revalidatePath("/app/channels");
}

export async function connectInstagramAction() {
  const ctx = await requireContext();
  const { url } = await beginConnect(ctx.svc.db, ctx.svc.registry, ctx.actor, {
    workspaceId: ctx.workspace.id,
    platform: "instagram_business",
    redirectUri: oauthRedirectUri(ctx.svc.config),
    redirectAfter: `${ctx.svc.config.APP_URL}/app/channels`,
  });
  redirect(url);
}

export async function connectFacebookAction() {
  const ctx = await requireContext();
  const { url } = await beginConnect(ctx.svc.db, ctx.svc.registry, ctx.actor, {
    workspaceId: ctx.workspace.id,
    platform: "facebook_page",
    redirectUri: oauthRedirectUri(ctx.svc.config),
    redirectAfter: `${ctx.svc.config.APP_URL}/app/channels`,
  });
  redirect(url);
}

/** Generic OAuth connect for every adapter platform (Mastodon additionally needs the instance). */
export async function connectPlatformAction(fd: FormData) {
  const ctx = await requireContext();
  const platform = String(fd.get("platform") ?? "") as Platform;
  if (!CONNECTABLE_PLATFORMS.includes(platform) || ["bluesky", "instagram_personal", "facebook_group", "substack"].includes(platform)) redirect("/app/channels?error=unsupported");
  let url: string;
  try {
    ({ url } = await beginConnect(ctx.svc.db, ctx.svc.registry, ctx.actor, {
      workspaceId: ctx.workspace.id,
      platform,
      instance: String(fd.get("instance") ?? "").trim() || undefined,
      redirectUri: oauthRedirectUri(ctx.svc.config),
      redirectAfter: `${ctx.svc.config.APP_URL}/app/channels`,
    }));
  } catch (e) {
    if (isAppError(e)) redirect(`/app/channels?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(url);
}

/** Reminder-only channel (Instagram personal, Facebook group, Substack): created by name, no network call. */
export async function createManualChannelAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await createManualChannel(ctx.svc.db, ctx.svc.ring, ctx.actor, { workspaceId: ctx.workspace.id, platform: String(fd.get("platform") ?? "") as Platform, displayName: String(fd.get("displayName") ?? ""), username: String(fd.get("username") ?? "") });
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Bluesky: handle + app password, used once for createSession and never stored. */
export async function connectBlueskyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await connectWithCredentials(ctx.svc.db, ctx.svc.ring, ctx.svc.registry, ctx.actor, { workspaceId: ctx.workspace.id, platform: "bluesky", identifier: String(fd.get("identifier") ?? ""), password: String(fd.get("password") ?? ""), service: String(fd.get("service") ?? "").trim() || undefined });
    revalidatePath("/app/channels");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectChannelAction(fd: FormData) {
  const ctx = await requireContext();
  await disconnectChannel(ctx.svc.db, ctx.svc.ring, ctx.svc.registry, ctx.actor, String(fd.get("channelId")));
  revalidatePath("/app/channels");
}

// ── API keys & webhooks ──
export async function createApiKeyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const scopes = fd.getAll("scopes").map(String).filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s));
  const name = String(fd.get("name") ?? "").trim();
  const exp = String(fd.get("expires") ?? "");
  if (name.length < 2 || scopes.length === 0) return { error: "Name und mindestens ein Scope erforderlich." };
  try {
    const r = await createApiKey(ctx.svc.db, ctx.actor, {
      name,
      scopes,
      workspaceIds: fd.getAll("workspaceIds").map(String).length ? fd.getAll("workspaceIds").map(String) : [ctx.workspace.id],
      environment: fd.get("environment") === "test" ? "test" : "live",
      expiresAt: exp ? new Date(`${exp}T23:59:59Z`) : undefined,
    });
    revalidatePath("/app/developer");
    return { ok: true, secret: r.secret };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeApiKeyAction(fd: FormData) {
  const ctx = await requireContext();
  await revokeApiKey(ctx.svc.db, ctx.actor, String(fd.get("keyId")));
  revalidatePath("/app/developer");
}

export async function rotateApiKeyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    const r = await rotateApiKey(ctx.svc.db, ctx.actor, String(fd.get("keyId")));
    revalidatePath("/app/developer");
    return { ok: true, secret: r.secret };
  } catch (e) {
    return fail(e);
  }
}

export async function createWebhookAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const url = String(fd.get("url") ?? "");
  const events = fd.getAll("events").map(String).filter((e): e is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) && ctx.svc.config.NODE_ENV !== "production";
  if (!(url.startsWith("https://") || isLocal) || events.length === 0) return { error: "HTTPS-URL und mindestens ein Ereignis erforderlich." };
  try {
    const r = await createWebhook(ctx.svc.db, ctx.svc.ring, ctx.actor, { url, events });
    revalidatePath("/app/developer");
    return { ok: true, secret: r.secret };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteWebhookAction(fd: FormData) {
  const ctx = await requireContext();
  await deleteWebhook(ctx.svc.db, ctx.actor, String(fd.get("webhookId")));
  revalidatePath("/app/developer");
}

// ── Posts ──
export async function createReelAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const accountIds = fd.getAll("accountIds").map(String);
  const coverMode = fd.get("coverMode") === "independent_image" ? "independent_image" : "video_frame";
  const intent = fd.get("intent") === "schedule" ? "scheduled" : "draft";
  const when = String(fd.get("when") ?? "");
  let scheduledAt: string | undefined;
  if (when) {
    const wall = parseLocalDateTime(when);
    if (!wall) return { error: "Ungültiges Datum." };
    try {
      scheduledAt = wallClockToUtc(wall, ctx.workspace.timezone).toISOString();
    } catch (e) {
      if (e instanceof NonexistentLocalTimeError) return { error: "dstGap" };
      throw e;
    }
  }
  if (intent === "scheduled" && !scheduledAt) return { error: "Bitte einen Zeitpunkt wählen." };
  const thumbSec = Number(fd.get("thumbOffset") ?? "");
  let postId: string;
  try {
    const r = await createPost(ctx.svc.db, ctx.svc.registry, ctx.actor, {
      workspace_id: ctx.workspace.id,
      account_ids: accountIds,
      type: "reel",
      caption: String(fd.get("caption") ?? ""),
      media_asset_ids: [],
      video_asset_id: String(fd.get("videoAssetId") ?? "") || undefined,
      cover_asset_id: coverMode === "independent_image" ? String(fd.get("coverAssetId") ?? "") || undefined : undefined,
      cover_mode: coverMode,
      thumb_offset_ms: coverMode === "video_frame" && Number.isFinite(thumbSec) && thumbSec > 0 ? Math.round(thumbSec * 1000) : undefined,
      scheduled_at: scheduledAt,
      status: intent,
      publish_mode: fd.get("publishMode") === "notification" ? "notification" : "automatic",
    });
    postId = r.post.id;
  } catch (e) {
    return fail(e);
  }
  redirect(`/app/posts/${postId}`);
}

async function postAction(fd: FormData, run: (ctx: Awaited<ReturnType<typeof requireContext>>, id: string) => Promise<unknown>) {
  const ctx = await requireContext();
  const id = String(fd.get("postId"));
  await run(ctx, id);
  revalidatePath(`/app/posts/${id}`);
  revalidatePath("/app/publish");
}
export async function approvePostAction(fd: FormData) {
  await postAction(fd, (c, id) => decideApproval(c.svc.db, c.actor, id, "approved", String(fd.get("comment") ?? "") || undefined));
}
export async function requestChangesAction(fd: FormData) {
  await postAction(fd, (c, id) => decideApproval(c.svc.db, c.actor, id, "changes_requested", String(fd.get("comment") ?? "") || undefined));
}
export async function submitApprovalAction(fd: FormData) {
  await postAction(fd, (c, id) => submitForApproval(c.svc.db, c.actor, id));
}
export async function publishNowAction(fd: FormData) {
  await postAction(fd, (c, id) => requestPublish(c.svc.db, c.actor, id));
}
export async function cancelPostAction(fd: FormData) {
  await postAction(fd, (c, id) => cancelPost(c.svc.db, c.actor, id));
}

// ── Security ──
export async function beginTotpAction(): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await beginTotpSetup(ctx.svc.db, ctx.svc.ring, ctx.user.id);
  return { ok: true, secret: r.secret, details: r.uri };
}
export async function confirmTotpAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await confirmTotp(ctx.svc.db, ctx.svc.ring, ctx.user.id, String(fd.get("code") ?? "").trim());
    revalidatePath("/app/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function markNotificationsReadAction() {
  const ctx = await requireContext();
  await ctx.svc.db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, ctx.user.id), eq(schema.notifications.organizationId, ctx.organization.id), isNull(schema.notifications.readAt)));
  revalidatePath("/app", "layout");
}

// ── Team ──
export async function inviteMemberAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const role = String(fd.get("role") ?? "") as Role;
  if (!(ROLES as readonly string[]).includes(role)) return { error: "Ungültige Rolle." };
  try {
    const r = await inviteMember(ctx.svc.db, ctx.svc.mailer, ctx.actor, {
      email: String(fd.get("email") ?? ""),
      role,
      workspaceId: String(fd.get("workspaceId") ?? "") || null,
      appUrl: ctx.svc.config.APP_URL,
      organizationName: ctx.organization.name,
      locale: ctx.user.locale,
    });
    revalidatePath("/app/team");
    // `secret` carries the manual link only when the mail was NOT delivered.
    return { ok: true, secret: r.link ?? undefined, details: r.delivered };
  } catch (e) {
    return fail(e);
  }
}

export async function changeRoleAction(fd: FormData) {
  const ctx = await requireContext();
  await changeMemberRole(ctx.svc.db, ctx.actor, String(fd.get("membershipId")), String(fd.get("role")) as Role);
  revalidatePath("/app/team");
}

export async function removeMemberAction(fd: FormData) {
  const ctx = await requireContext();
  await removeMember(ctx.svc.db, ctx.actor, String(fd.get("membershipId")));
  revalidatePath("/app/team");
}

export async function resendVerificationAction(): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.user.emailVerifiedAt) return { ok: true };
  const token = await createEmailVerification(ctx.svc.db, ctx.user.id);
  const r = await ctx.svc.mailer.send({ to: ctx.user.email, ...mailTemplates.verify(ctx.user.locale, `${ctx.svc.config.APP_URL}/verify/${token}`) });
  return { ok: true, details: r.delivered };
}

// ── Calendar / queue (Sprint 2) ──
export async function reschedulePostAction(postId: string, isoUtc: string): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await reschedulePost(ctx.svc.db, ctx.actor, postId, new Date(isoUtc));
    revalidatePath("/app/calendar");
    revalidatePath("/app/publish");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function rescheduleFormAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const wall = parseLocalDateTime(String(fd.get("when") ?? ""));
  if (!wall) return { error: "Ungültiges Datum." };
  try {
    const at = wallClockToUtc(wall, ctx.workspace.timezone);
    await reschedulePost(ctx.svc.db, ctx.actor, String(fd.get("postId")), at);
    revalidatePath(`/app/posts/${fd.get("postId")}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof NonexistentLocalTimeError) return { error: "dstGap" };
    return fail(e);
  }
}

export async function bulkShiftAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const ids = fd.getAll("postIds").map(String);
  const minutes = Number(fd.get("days") ?? 0) * 1440 + Number(fd.get("hours") ?? 0) * 60;
  if (!ids.length || !minutes) return { error: "Beiträge und Verschiebung wählen." };
  try {
    await bulkShift(ctx.svc.db, ctx.actor, ids, minutes);
    revalidatePath("/app/calendar");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveSlotsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const channelId = String(fd.get("channelId"));
  const slots = fd
    .getAll("slot")
    .map(String)
    .map((s) => {
      const [wd, hm] = s.split("@");
      const [h, m] = (hm ?? "").split(":").map(Number);
      return { weekday: Number(wd), minuteOfDay: (h ?? 0) * 60 + (m ?? 0) };
    });
  try {
    await setSlots(ctx.svc.db, ctx.actor, channelId, slots);
    revalidatePath(`/app/channels/${channelId}/queue`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function shuffleQueueAction(fd: FormData) {
  const ctx = await requireContext();
  const channelId = String(fd.get("channelId"));
  await shuffleQueue(ctx.svc.db, ctx.actor, channelId);
  revalidatePath(`/app/channels/${channelId}/queue`);
}

export async function toggleQueuePauseAction(fd: FormData) {
  const ctx = await requireContext();
  await setQueuePaused(ctx.svc.db, ctx.actor, ctx.workspace.id, fd.get("paused") === "true");
  revalidatePath("/app", "layout");
}

export async function clonePostAction(fd: FormData) {
  const ctx = await requireContext();
  const copy = await clonePost(ctx.svc.db, ctx.actor, String(fd.get("postId")));
  redirect(`/app/posts/${copy.id}`);
}

export async function queuePostAction(fd: FormData) {
  const ctx = await requireContext();
  const id = String(fd.get("postId"));
  await assignQueueSlots(ctx.svc.db, ctx.actor, id);
  revalidatePath(`/app/posts/${id}`);
}

export async function replayJobAction(fd: FormData) {
  const ctx = await requireContext();
  authorize(ctx.actor, null, "org.manage");
  const id = String(fd.get("jobId"));
  const [job] = await ctx.svc.db.select().from(schema.queueItems).where(and(eq(schema.queueItems.id, id), eq(schema.queueItems.organizationId, ctx.organization.id)));
  if (job && job.kind !== "publish_target") {
    await replayDeadJob(ctx.svc.db, id);
    if (job.kind === "deliver_webhook") await ctx.svc.db.update(schema.webhookDeliveries).set({ status: "pending" }).where(eq(schema.webhookDeliveries.id, String(job.payload.deliveryId)));
  }
  revalidatePath("/app/health");
}

// ── Generic composer (image / carousel / story / text / video) ──
export async function createGenericPostAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const type = String(fd.get("type")) as "image" | "carousel" | "story" | "text" | "video" | "thread";
  if (!["image", "carousel", "story", "text", "video", "thread"].includes(type)) return { error: "Ungültiges Format." };
  const accountIds = fd.getAll("accountIds").map(String);
  const mediaIds = String(fd.get("mediaIds") ?? "").split(",").filter(Boolean);
  const timing = String(fd.get("timing") ?? "exact");
  const intent = fd.get("intent") === "schedule" ? "scheduled" : "draft";
  let scheduledAt: string | undefined;
  if (intent === "scheduled" && timing === "exact") {
    const wall = parseLocalDateTime(String(fd.get("when") ?? ""));
    if (!wall) return { error: "Bitte einen Zeitpunkt wählen." };
    try {
      scheduledAt = wallClockToUtc(wall, ctx.workspace.timezone).toISOString();
    } catch (e) {
      if (e instanceof NonexistentLocalTimeError) return { error: "dstGap" };
      throw e;
    }
  }
  const targets = accountIds.map((id) => ({
    account_id: id,
    caption: String(fd.get(`caption_${id}`) ?? "").trim() || undefined,
    first_comment: String(fd.get(`fc_${id}`) ?? "").trim() || undefined,
    title: String(fd.get(`title_${id}`) ?? "").trim() || undefined,
    privacy: String(fd.get(`privacy_${id}`) ?? "").trim() || undefined,
    link: String(fd.get(`link_${id}`) ?? "").trim() || undefined,
  }));
  let postId: string;
  try {
    const isVideo = type === "video";
    const r = await createPost(ctx.svc.db, ctx.svc.registry, ctx.actor, {
      workspace_id: ctx.workspace.id,
      account_ids: accountIds,
      type,
      caption: String(fd.get("caption") ?? ""),
      media_asset_ids: isVideo ? [] : mediaIds,
      video_asset_id: isVideo ? mediaIds[0] : undefined,
      scheduled_at: scheduledAt,
      queue: intent === "scheduled" && timing === "queue" ? true : undefined,
      status: intent,
      publish_mode: fd.get("publishMode") === "notification" ? "notification" : "automatic",
      targets,
    });
    postId = r.post.id;
  } catch (e) {
    return fail(e);
  }
  redirect(`/app/posts/${postId}`);
}

export async function bakeCoverAction(videoAssetId: string, coverAssetId: string, consent: boolean): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    const a = await bakeCoverIntoVideo(ctx.svc.db, ctx.svc.storage, ctx.actor, {
      videoAssetId,
      coverAssetId,
      consent,
      ffmpegPath: ctx.svc.config.FFMPEG_PATH,
      tools: { ffprobePath: ctx.svc.config.FFPROBE_PATH, clamavHost: ctx.svc.config.CLAMAV_HOST, clamavPort: ctx.svc.config.CLAMAV_PORT },
    });
    return { ok: true, details: { id: a.id, width: a.width, height: a.height, durationMs: a.durationMs } };
  } catch (e) {
    return fail(e);
  }
}
