"use server";
import { revalidatePath } from "next/cache";
import {
  getOrCreateStartPage,
  updateStartPage,
  addBlock,
  updateBlock,
  deleteBlock,
  moveBlock,
  addGridItem,
  deleteGridItem,
  publishStartPage,
  revertStartPageDraft,
  unpublishStartPage,
  createShortLink,
  disableShortLink,
  shortenLinksInText,
  connectBitly,
  disconnectIntegration,
  bitlyShorten,
  unsplashSearch,
  unsplashImport,
  isAppError,
  type BlockType,
  type UnsplashPhoto,
} from "@sichttakt/core";
import { requireContext } from "@/lib/server";
import type { ActionResult } from "./actions";

function fail(e: unknown): ActionResult {
  if (isAppError(e)) return { error: e.message, details: e.details };
  throw e;
}
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function shortBase() {
  const { svc } = await requireContext();
  return (svc.config.SHORTLINK_BASE_URL ?? `${svc.config.APP_URL}/l`).replace(/\/$/, "");
}

/** Builds block data from the builder form; validation happens in core (zod). */
function blockData(type: BlockType, fd: FormData): Record<string, unknown> {
  switch (type) {
    case "button":
      return { label: str(fd, "label"), url: str(fd, "url") };
    case "text":
      return { text: str(fd, "text"), align: str(fd, "align") || "center" };
    case "image":
      return { assetId: str(fd, "assetId"), alt: str(fd, "alt"), ...(str(fd, "url") ? { url: str(fd, "url") } : {}) };
    case "video":
      return { assetId: str(fd, "assetId"), ...(str(fd, "caption") ? { caption: str(fd, "caption") } : {}) };
    case "social_links":
      return {
        links: str(fd, "links")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const [network = "", ...rest] = l.split(/\s+/);
            return { network: network.toLowerCase(), url: rest.join(" ") };
          }),
      };
    case "image_grid":
      return { items: fd.getAll("assetIds").map((a) => ({ assetId: String(a), alt: "" })) };
    case "shop_grid":
      return str(fd, "title") ? { title: str(fd, "title") } : {};
  }
}

async function pageAction(run: (ctx: Awaited<ReturnType<typeof requireContext>>, pageId: string) => Promise<unknown>): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    const page = await getOrCreateStartPage(ctx.svc.db, ctx.actor, ctx.workspace.id);
    await run(ctx, page.id);
    revalidatePath("/app/start-page");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveStartPageAction(_: ActionResult, fd: FormData) {
  return pageAction((ctx, id) =>
    updateStartPage(ctx.svc.db, ctx.actor, id, {
      slug: str(fd, "slug"),
      title: str(fd, "title"),
      description: str(fd, "description"),
      theme: { preset: str(fd, "preset") as "paper", font: str(fd, "font") as "grotesk", buttonStyle: str(fd, "buttonStyle") as "filled", avatarAssetId: str(fd, "avatarAssetId") || null },
    }),
  );
}

export async function addBlockAction(_: ActionResult, fd: FormData) {
  const type = str(fd, "type") as BlockType;
  return pageAction((ctx, id) => addBlock(ctx.svc.db, ctx.actor, id, type, blockData(type, fd)));
}

export async function updateBlockAction(_: ActionResult, fd: FormData) {
  const type = str(fd, "type") as BlockType;
  return pageAction((ctx) => updateBlock(ctx.svc.db, ctx.actor, str(fd, "blockId"), blockData(type, fd)));
}

export async function deleteBlockAction(fd: FormData) {
  await pageAction((ctx) => deleteBlock(ctx.svc.db, ctx.actor, str(fd, "blockId")));
}

export async function moveBlockAction(fd: FormData) {
  await pageAction((ctx) => moveBlock(ctx.svc.db, ctx.actor, str(fd, "blockId"), Number(fd.get("index"))));
}

export async function addGridItemAction(_: ActionResult, fd: FormData) {
  return pageAction((ctx, id) => addGridItem(ctx.svc.db, ctx.actor, id, { publishedPostId: str(fd, "publishedPostId") || undefined, imageAssetId: str(fd, "imageAssetId") || undefined, targetUrl: str(fd, "targetUrl") }));
}

export async function deleteGridItemAction(fd: FormData) {
  await pageAction((ctx) => deleteGridItem(ctx.svc.db, ctx.actor, str(fd, "itemId")));
}

export async function publishStartPageAction(fd: FormData) {
  void fd;
  await pageAction((ctx, id) => publishStartPage(ctx.svc.db, ctx.actor, id));
}
export async function revertStartPageAction(fd: FormData) {
  void fd;
  await pageAction((ctx, id) => revertStartPageDraft(ctx.svc.db, ctx.actor, id));
}
export async function unpublishStartPageAction(fd: FormData) {
  void fd;
  await pageAction((ctx, id) => unpublishStartPage(ctx.svc.db, ctx.actor, id));
}

// ── Short links ──
export async function createShortLinkAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await createShortLink(ctx.svc.db, ctx.actor, { workspaceId: ctx.workspace.id, targetUrl: str(fd, "url") });
    revalidatePath("/app/links");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function disableShortLinkAction(fd: FormData) {
  const ctx = await requireContext();
  await disableShortLink(ctx.svc.db, ctx.actor, str(fd, "linkId"));
  revalidatePath("/app/links");
}

/** Caption tool: replace every URL with a short link (own domain or the org's Bitly). */
export async function shortenCaptionAction(text: string, provider: "own" | "bitly" = "own"): Promise<{ text?: string; error?: string }> {
  const ctx = await requireContext();
  try {
    if (provider === "own") return { text: await shortenLinksInText(ctx.svc.db, ctx.actor, { workspaceId: ctx.workspace.id, text, baseUrl: await shortBase() }) };
    const urls = [...new Set(text.match(/https?:\/\/[^\s<>"]+/g) ?? [])].map((m) => m.replace(/[.,;:!?)\]]+$/, "")).filter((u) => !/^https?:\/\/bit\.ly\//.test(u));
    let out = text;
    for (const u of urls) out = out.split(u).join(await bitlyShorten(ctx.svc.db, ctx.svc.ring, ctx.actor, u));
    return { text: out };
  } catch (e) {
    if (isAppError(e)) return { error: e.message };
    throw e;
  }
}

// ── Integrations ──
export async function connectBitlyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  try {
    await connectBitly(ctx.svc.db, ctx.svc.ring, ctx.actor, str(fd, "token"));
    revalidatePath("/app/integrations");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectIntegrationAction(fd: FormData) {
  const ctx = await requireContext();
  await disconnectIntegration(ctx.svc.db, ctx.actor, str(fd, "provider"));
  revalidatePath("/app/integrations");
}

export async function unsplashSearchAction(query: string): Promise<{ photos?: UnsplashPhoto[]; error?: string }> {
  const ctx = await requireContext();
  try {
    return { photos: await unsplashSearch(ctx.svc.config, query) };
  } catch (e) {
    if (isAppError(e)) return { error: e.message };
    throw e;
  }
}

export async function unsplashImportAction(photoId: string): Promise<{ ok?: boolean; credit?: string; error?: string }> {
  const ctx = await requireContext();
  try {
    const r = await unsplashImport(ctx.svc.db, ctx.svc.storage, ctx.svc.config, ctx.actor, { workspaceId: ctx.workspace.id, photoId, tools: { ffprobePath: ctx.svc.config.FFPROBE_PATH, clamavHost: ctx.svc.config.CLAMAV_HOST, clamavPort: ctx.svc.config.CLAMAV_PORT } });
    revalidatePath("/app/media");
    return { ok: true, credit: r.credit };
  } catch (e) {
    if (isAppError(e)) return { error: e.message };
    throw e;
  }
}
