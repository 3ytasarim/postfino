import { ArrowDown, ArrowUp, ExternalLink, Trash2, LayoutGrid, Link2 } from "lucide-react";
import { and, desc, eq, schema } from "@sichttakt/db";
import { getOrCreateStartPage, listBlocks, listGridItems, listMedia, startPageStats, type StartPageSnapshot, type BlockType } from "@sichttakt/core";
import { PageHeader, Stat, Notice } from "@/components/ui";
import { FormAction } from "@/components/form-action";
import { BlockForm } from "@/components/block-form";
import { StartPageView } from "@/components/start-page-view";
import { BarChart } from "@/components/bar-chart";
import { getMessages, intlLocale } from "@/i18n";
import { requireContext } from "@/lib/server";
import {
  saveStartPageAction,
  addBlockAction,
  updateBlockAction,
  deleteBlockAction,
  moveBlockAction,
  addGridItemAction,
  deleteGridItemAction,
  publishStartPageAction,
  revertStartPageAction,
  unpublishStartPageAction,
} from "../actions-links";

export const metadata = { title: "Start Page" };

export default async function StartPageBuilder() {
  const ctx = await requireContext();
  const { t, locale } = await getMessages();
  const s = t.startPageUi;
  const db = ctx.svc.db;
  const page = await getOrCreateStartPage(db, ctx.actor, ctx.workspace.id);
  const [blocks, grid, media, stats, published] = await Promise.all([
    listBlocks(db, page.id),
    listGridItems(db, page.id),
    listMedia(db, ctx.actor, ctx.workspace.id),
    startPageStats(db, ctx.actor, page.id),
    db
      .select({ id: schema.publishedPosts.id, permalink: schema.publishedPosts.permalink, platform: schema.publishedPosts.platform, publishedAt: schema.publishedPosts.publishedAt, caption: schema.posts.caption })
      .from(schema.publishedPosts)
      .innerJoin(schema.postTargets, eq(schema.postTargets.id, schema.publishedPosts.postTargetId))
      .innerJoin(schema.posts, eq(schema.posts.id, schema.postTargets.postId))
      .where(and(eq(schema.publishedPosts.workspaceId, ctx.workspace.id), eq(schema.publishedPosts.organizationId, ctx.organization.id)))
      .orderBy(desc(schema.publishedPosts.publishedAt))
      .limit(30),
  ]);
  const assets = media.filter((m) => m.status === "ready" && (m.kind === "image" || m.kind === "video")).map((m) => ({ id: m.id, name: m.originalFilename ?? m.id.slice(0, 8), kind: m.kind }));
  const images = assets.filter((a) => a.kind === "image");
  const theme = page.theme as StartPageSnapshot["theme"];
  const draft = { title: page.title, description: page.description, theme, blocks: blocks.map((b) => ({ id: b.id, type: b.type as BlockType, data: b.data })), grid: grid.map((g) => ({ id: g.id, imageAssetId: g.imageAssetId!, targetUrl: g.targetUrl })) };
  const snap = page.publishedSnapshot as StartPageSnapshot | null;
  // Canonical JSON (sorted keys, null/undefined dropped): jsonb does not preserve key order.
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== null).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v);
  const strip = (x: { title: string; description: string | null; theme: unknown; blocks: unknown; grid: unknown }) => JSON.stringify(canon([x.title, x.description ?? null, x.theme, x.blocks, x.grid]));
  const changed = snap ? strip(snap) !== strip(draft) : true;
  const hasShopGrid = blocks.some((b) => b.type === "shop_grid");
  const typeLabels = s.types.split(",");
  const typeLabel = (k: string) => typeLabels[["button", "text", "image", "video", "social_links", "image_grid", "shop_grid"].indexOf(k)] ?? k;
  const nf = new Intl.NumberFormat(intlLocale(locale));
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
  const presets = s.presets.split(",");
  const fonts = s.fonts.split(",");
  const summary = (b: (typeof blocks)[number]) => {
    const d = b.data as Record<string, unknown>;
    if (b.type === "button") return `${d.label} → ${d.url}`;
    if (b.type === "text") return String(d.text).slice(0, 80);
    if (b.type === "social_links") return (d.links as { network: string }[]).map((l) => l.network).join(", ");
    if (b.type === "image_grid") return `${(d.items as unknown[]).length} ×`;
    if (b.type === "shop_grid") return `${grid.length} ${s.shopGrid}`;
    return assets.find((a) => a.id === d.assetId)?.name ?? "";
  };

  return (
    <>
      <PageHeader
        title={s.title}
        subtitle={s.subtitle}
        actions={
          <>
            {snap && (
              <a href={`/p/${page.slug}`} target="_blank" rel="noreferrer" className="btn btn-ghost">
                <ExternalLink className="size-4" /> {s.viewPublic}
              </a>
            )}
            <form action={publishStartPageAction}>
              <button className="btn btn-primary" disabled={!changed && !!snap}>
                {snap ? s.republish : s.publish}
              </button>
            </form>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className={`chip ${snap ? "bg-ok-soft text-ok" : "bg-surface-2 text-ink-2"}`}>
          {snap ? `${s.published} · ${s.version} ${snap.version}` : s.notPublished}
        </span>
        {page.publishedAt && <span className="text-sm text-ink-3">{df.format(page.publishedAt)}</span>}
        <span className="text-sm text-ink-2">{snap ? (changed ? s.draftChanged : s.upToDate) : null}</span>
        {snap && changed && (
          <form action={revertStartPageAction}>
            <button className="btn btn-ghost !min-h-[34px] text-xs">{s.revert}</button>
          </form>
        )}
        {snap && (
          <form action={unpublishStartPageAction}>
            <button className="btn btn-danger !min-h-[34px] text-xs">{s.unpublish}</button>
          </form>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <section className="card p-6">
            <h2 className="mb-4 text-lg font-bold">{s.settings}</h2>
            <FormAction action={saveStartPageAction} submit={t.common.save} className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="sp-slug">
                  {s.slug}
                </label>
                <div className="flex items-center rounded-[12px] border border-line bg-bg focus-within:ring-2 focus-within:ring-takt">
                  <span className="pl-3 text-sm text-ink-3">/p/</span>
                  <input id="sp-slug" name="slug" defaultValue={page.slug} pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" className="input !border-0 !pl-1 !ring-0" required />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="sp-title">
                  {s.pageTitle}
                </label>
                <input id="sp-title" name="title" defaultValue={page.title} maxLength={80} className="input" required />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="sp-desc">
                  {s.description}
                </label>
                <textarea id="sp-desc" name="description" defaultValue={page.description ?? ""} maxLength={300} className="input min-h-[70px]" />
              </div>
              <div>
                <label className="label" htmlFor="sp-preset">
                  {s.theme}
                </label>
                <select id="sp-preset" name="preset" defaultValue={theme.preset} className="input">
                  {["takt", "paper", "mint", "night"].map((p, i) => (
                    <option key={p} value={p}>
                      {presets[i]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="sp-font">
                  {s.font}
                </label>
                <select id="sp-font" name="font" defaultValue={theme.font} className="input">
                  {["grotesk", "serif", "sans"].map((f, i) => (
                    <option key={f} value={f}>
                      {fonts[i]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="sp-btn">
                  {s.buttonStyle}
                </label>
                <select id="sp-btn" name="buttonStyle" defaultValue={theme.buttonStyle} className="input">
                  <option value="filled">{s.filled}</option>
                  <option value="outline">{s.outline}</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="sp-avatar">
                  {s.avatar}
                </label>
                <select id="sp-avatar" name="avatarAssetId" defaultValue={theme.avatarAssetId ?? ""} className="input">
                  <option value="">{s.noAvatar}</option>
                  {images.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </FormAction>
          </section>

          <section className="card p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
              <Link2 className="size-5" /> {s.blocks}
            </h2>
            {blocks.length === 0 ? (
              <p className="mb-4 text-sm text-ink-3">{s.emptyBlocks}</p>
            ) : (
              <ol className="mb-5 divide-y divide-line rounded-[14px] border border-line">
                {blocks.map((b, i) => (
                  <li key={b.id} className="p-3">
                    <div className="flex items-center gap-2">
                      <span className="chip bg-surface-2 text-ink-2">{typeLabel(b.type)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{summary(b)}</span>
                      {stats.clicksByBlock[b.id] !== undefined && (
                        <span className="text-xs tabular-nums text-ink-3">
                          {nf.format(stats.clicksByBlock[b.id]!)} {s.clicks}
                        </span>
                      )}
                      <form action={moveBlockAction}>
                        <input type="hidden" name="blockId" value={b.id} />
                        <input type="hidden" name="index" value={i - 1} />
                        <button className="btn btn-ghost !min-h-[36px] !px-2" disabled={i === 0} aria-label={s.moveUp}>
                          <ArrowUp className="size-4" />
                        </button>
                      </form>
                      <form action={moveBlockAction}>
                        <input type="hidden" name="blockId" value={b.id} />
                        <input type="hidden" name="index" value={i + 1} />
                        <button className="btn btn-ghost !min-h-[36px] !px-2" disabled={i === blocks.length - 1} aria-label={s.moveDown}>
                          <ArrowDown className="size-4" />
                        </button>
                      </form>
                      <form action={deleteBlockAction}>
                        <input type="hidden" name="blockId" value={b.id} />
                        <button className="btn btn-ghost !min-h-[36px] !px-2 text-bad" aria-label={t.common.delete}>
                          <Trash2 className="size-4" />
                        </button>
                      </form>
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-ink-2">{s.edit}</summary>
                      <div className="mt-3">
                        <BlockForm action={updateBlockAction} t={s} assets={assets} hasShopGrid={hasShopGrid} block={{ id: b.id, type: b.type as BlockType, data: b.data }} />
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            )}
            <details className="rounded-[14px] border border-line p-4" open={blocks.length === 0}>
              <summary className="cursor-pointer font-semibold">{s.addBlock}</summary>
              <div className="mt-4">
                <BlockForm action={addBlockAction} t={s} assets={assets} hasShopGrid={hasShopGrid} />
              </div>
            </details>
          </section>

          <section className="card p-6">
            <h2 className="mb-1 flex items-center gap-2 text-lg font-bold">
              <LayoutGrid className="size-5" /> {s.shopGrid}
            </h2>
            <p className="mb-4 text-sm text-ink-2">{s.shopGridHint}</p>
            {!hasShopGrid && grid.length > 0 && (
              <div className="mb-4">
                <Notice>{s.needShopBlock}</Notice>
              </div>
            )}
            {grid.length > 0 && (
              <ul className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {grid.map((g) => (
                  <li key={g.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/app/api/media/${g.imageAssetId}`} alt="" className="aspect-square w-full rounded-[10px] object-cover" />
                    <p className="mt-1 truncate text-[0.7rem] text-ink-3" title={g.targetUrl}>
                      {g.targetUrl.replace(/^https?:\/\//, "")}
                    </p>
                    {stats.clicksByBlock[g.id] !== undefined && <p className="text-[0.7rem] tabular-nums text-ink-3">{nf.format(stats.clicksByBlock[g.id]!)} {s.clicks}</p>}
                    <form action={deleteGridItemAction} className="absolute top-1 right-1">
                      <input type="hidden" name="itemId" value={g.id} />
                      <button className="grid size-8 place-items-center rounded-full bg-black/60 text-white" aria-label={t.common.delete}>
                        <Trash2 className="size-3.5" />
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[14px] border border-line p-4">
                <p className="mb-3 font-semibold">{s.gridFromPost}</p>
                {published.length === 0 ? (
                  <p className="text-sm text-ink-3">{s.noPublished}</p>
                ) : (
                  <FormAction action={addGridItemAction} submit={t.common.create} className="space-y-3" resetOnSuccess>
                    <select name="publishedPostId" className="input" aria-label={s.gridFromPost} required>
                      {published.map((p) => (
                        <option key={p.id} value={p.id}>
                          {df.format(p.publishedAt)} · {(p.caption ?? "").slice(0, 50) || p.platform}
                        </option>
                      ))}
                    </select>
                    <input name="targetUrl" type="url" className="input" placeholder={`${s.targetUrl} (https://)`} aria-label={s.targetUrl} required />
                  </FormAction>
                )}
              </div>
              <div className="rounded-[14px] border border-line p-4">
                <p className="mb-3 font-semibold">{s.gridFromAsset}</p>
                {images.length === 0 ? (
                  <p className="text-sm text-ink-3">{s.noImages}</p>
                ) : (
                  <FormAction action={addGridItemAction} submit={t.common.create} className="space-y-3" resetOnSuccess>
                    <select name="imageAssetId" className="input" aria-label={s.gridFromAsset} required>
                      {images.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <input name="targetUrl" type="url" className="input" placeholder={`${s.targetUrl} (https://)`} aria-label={s.targetUrl} required />
                  </FormAction>
                )}
              </div>
            </div>
          </section>

          <section className="card p-6">
            <h2 className="mb-4 text-lg font-bold">{s.stats}</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label={s.views} value={nf.format(stats.views)} />
              <Stat label={s.clicks} value={nf.format(stats.clicks)} tone="puls" />
              <Stat label={s.ctr} value={stats.ctr === null ? t.common.na : `${stats.ctr.toLocaleString(intlLocale(locale))} %`} tone="ok" />
            </div>
            <div className="mt-5">
              <BarChart data={stats.viewsByDay} label={s.views} locale={intlLocale(locale)} emptyText={t.common.none} />
            </div>
            <p className="mt-3 text-xs text-ink-3">{s.statsNote}</p>
          </section>
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <p className="eyebrow mb-2">{s.preview}</p>
          <div className="mx-auto h-[720px] w-full max-w-[380px] overflow-y-auto rounded-[36px] border-[10px] border-ink shadow-xl">
            <StartPageView page={draft} compact mediaUrl={(id) => `/app/api/media/${id}`} hrefFor={() => null} />
          </div>
        </aside>
      </div>
    </>
  );
}
