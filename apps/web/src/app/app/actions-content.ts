"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createIdea,
  updateIdea,
  moveIdea,
  deleteIdea,
  convertIdeaToPost,
  saveTemplate,
  deleteTemplate,
  addFeed,
  removeFeed,
  addNote,
  createReviewLink,
  saveBrandVoice,
  previewImport,
  commitImport,
  isAppError,
  updateWorkspace,
} from "@sichttakt/core";
import { POST_TYPES, type PostType } from "@sichttakt/shared";
import { requireContext } from "@/lib/server";
import type { ActionResult } from "./actions";

function fail(e: unknown): ActionResult {
  if (isAppError(e)) return { error: e.message, details: e.details };
  throw e;
}
const lines = (v: FormDataEntryValue | null) => String(v ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

// ── Ideas ──
export async function createIdeaAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await createIdea(ctx.svc.db, ctx.actor, {
      workspaceId: ctx.workspace.id,
      columnId: String(fd.get("columnId") ?? "") || undefined,
      title: String(fd.get("title") ?? ""),
      body: String(fd.get("body") ?? ""),
      links: lines(fd.get("links")),
      tags: String(fd.get("tags") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    });
    revalidatePath("/app/ideas");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updateIdeaAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await updateIdea(ctx.svc.db, ctx.actor, String(fd.get("ideaId")), {
      title: String(fd.get("title") ?? ""),
      body: String(fd.get("body") ?? ""),
      links: lines(fd.get("links")),
      tags: String(fd.get("tags") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    });
    revalidatePath("/app/ideas");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function moveIdeaAction(ideaId: string, columnId: string, index: number): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await moveIdea(ctx.svc.db, ctx.actor, ideaId, columnId, index);
    revalidatePath("/app/ideas");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteIdeaAction(fd: FormData) {
  const ctx = await requireContext();
  await deleteIdea(ctx.svc.db, ctx.actor, String(fd.get("ideaId")));
  revalidatePath("/app/ideas");
}

export async function ideaToPostAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const type = String(fd.get("type")) as PostType;
  if (!(POST_TYPES as readonly string[]).includes(type)) return { error: "Ungültiges Format." };
  let id: string;
  try {
    const post = await convertIdeaToPost(ctx.svc.db, ctx.svc.registry, ctx.actor, String(fd.get("ideaId")), { accountIds: fd.getAll("accountIds").map(String), type });
    id = post.id;
  } catch (e) {
    return fail(e);
  }
  redirect(`/app/posts/${id}`);
}

// ── Templates & feeds ──
export async function saveTemplateAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const kind = String(fd.get("kind")) as "caption" | "hashtags" | "first_comment";
  try {
    await saveTemplate(ctx.svc.db, ctx.actor, { workspaceId: ctx.workspace.id, id: String(fd.get("id") ?? "") || undefined, name: String(fd.get("name") ?? ""), kind: ["caption", "hashtags", "first_comment"].includes(kind) ? kind : "caption", body: String(fd.get("body") ?? "") });
    revalidatePath("/app/ideas");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTemplateAction(fd: FormData) {
  const ctx = await requireContext();
  await deleteTemplate(ctx.svc.db, ctx.actor, String(fd.get("id")));
  revalidatePath("/app/ideas");
}

export async function addFeedAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await addFeed(ctx.svc.db, ctx.actor, { workspaceId: ctx.workspace.id, url: String(fd.get("url") ?? "").trim(), allowPrivate: ctx.svc.config.NODE_ENV !== "production" });
    revalidatePath("/app/ideas");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeFeedAction(fd: FormData) {
  const ctx = await requireContext();
  await removeFeed(ctx.svc.db, ctx.actor, String(fd.get("feedId")));
  revalidatePath("/app/ideas");
}

// ── Collaboration ──
export async function addNoteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    const postId = String(fd.get("postId") ?? "") || undefined;
    await addNote(ctx.svc.db, ctx.actor, { postId, ideaId: String(fd.get("ideaId") ?? "") || undefined, body: String(fd.get("body") ?? ""), visibleToClient: fd.get("visibleToClient") === "on" });
    if (postId) revalidatePath(`/app/posts/${postId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function createReviewLinkAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    const r = await createReviewLink(ctx.svc.db, ctx.actor, String(fd.get("postId")), ctx.svc.config.APP_URL);
    return { ok: true, secret: r.url };
  } catch (e) {
    return fail(e);
  }
}

export async function saveBrandVoiceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await saveBrandVoice(ctx.svc.db, ctx.actor, ctx.workspace.id, {
      description: String(fd.get("description") ?? ""),
      dos: lines(fd.get("dos")),
      donts: lines(fd.get("donts")),
      examples: lines(fd.get("examples")),
      language: ["de", "en", "tr"].includes(String(fd.get("language"))) ? String(fd.get("language")) : "de",
    });
    revalidatePath("/app/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── Bulk import ──
export type ImportState = { error?: string; importId?: string; reused?: boolean; committed?: boolean } | undefined;

export async function previewImportAction(_: ImportState, fd: FormData): Promise<ImportState> {
  const ctx = await requireContext();
  const csv = fd.get("csv");
  const zip = fd.get("zip");
  if (!(csv instanceof File) || csv.size === 0) return { error: "CSV-Datei fehlt." };
  if (csv.size > 2 * 1024 * 1024) return { error: "CSV größer als 2 MB." };
  const target = String(fd.get("target")) as "draft" | "queue" | "scheduled";
  try {
    const r = await previewImport(ctx.svc.db, ctx.svc.storage, ctx.actor, {
      workspaceId: ctx.workspace.id,
      filename: csv.name,
      csv: Buffer.from(await csv.arrayBuffer()),
      zip: zip instanceof File && zip.size > 0 ? Buffer.from(await zip.arrayBuffer()) : undefined,
      target: ["draft", "queue", "scheduled"].includes(target) ? target : "draft",
    });
    return { importId: r.import.id, reused: r.reused, committed: r.import.status !== "validated" };
  } catch (e) {
    if (isAppError(e)) return { error: e.message };
    throw e;
  }
}

export async function commitImportAction(fd: FormData) {
  const ctx = await requireContext();
  const id = String(fd.get("importId"));
  await commitImport(ctx.svc.db, ctx.svc.storage, ctx.svc.registry, ctx.actor, id, { ffprobePath: ctx.svc.config.FFPROBE_PATH, clamavHost: ctx.svc.config.CLAMAV_HOST, clamavPort: ctx.svc.config.CLAMAV_PORT });
  redirect(`/app/media/import?id=${id}`);
}

export async function updateWorkspaceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await updateWorkspace(ctx.svc.db, ctx.actor, ctx.workspace.id, { name: String(fd.get("name") ?? ""), timezone: String(fd.get("timezone") ?? ctx.workspace.timezone), approvalRequired: fd.get("approvalRequired") === "on" });
    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
