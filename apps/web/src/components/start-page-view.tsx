import type { StartPageSnapshot } from "@sichttakt/core";
import { THEMES } from "@sichttakt/core";

// Renders a Start Page (published snapshot or draft) — no hooks, usable on the public page and in the builder preview.
// Colours come from the page's own theme, not from the app tokens, so the page looks the same for every visitor.

type Props = {
  page: Pick<StartPageSnapshot, "title" | "description" | "theme" | "blocks" | "grid">;
  mediaUrl: (assetId: string) => string;
  /** Click href for a block / grid tile (tracked redirect on the public page, direct URL in the preview). */
  hrefFor: (id: string, index?: number) => string | null;
  compact?: boolean;
  /** White-label: hide the "made with Postfino" line. */
  hidePoweredBy?: boolean;
};

const FONT = { grotesk: "var(--font-grotesk), system-ui, sans-serif", serif: "Georgia, 'Times New Roman', serif", sans: "var(--font-inter), system-ui, sans-serif" } as const;
const NET_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", x: "X", threads: "Threads", pinterest: "Pinterest", bluesky: "Bluesky", mastodon: "Mastodon", website: "Website", email: "E-Mail" };

export function StartPageView({ page, mediaUrl, hrefFor, compact, hidePoweredBy }: Props) {
  const th = THEMES[page.theme.preset] ?? THEMES.paper;
  const outline = page.theme.buttonStyle === "outline";
  const initials = page.title.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const shopTitle = page.blocks.find((b) => b.type === "shop_grid");
  return (
    <div style={{ background: th.bg, color: th.fg, fontFamily: FONT[page.theme.font] ?? FONT.grotesk }} className={compact ? "min-h-full px-5 py-8" : "min-h-dvh px-4 py-12 sm:py-16"}>
      <div className="mx-auto flex max-w-[480px] flex-col items-center text-center">
        {page.theme.avatarAssetId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(page.theme.avatarAssetId)} alt="" className="size-24 rounded-full object-cover" style={{ boxShadow: `0 0 0 3px ${th.bg}, 0 0 0 5px ${th.accent}` }} />
        ) : (
          <span className="grid size-24 place-items-center rounded-full text-2xl font-bold" style={{ background: th.accent, color: th.bg }} aria-hidden>
            {initials}
          </span>
        )}
        <h1 className="mt-5 text-2xl font-bold leading-tight tracking-tight">{page.title}</h1>
        {page.description && <p className="mt-2 max-w-sm text-[0.95rem] leading-relaxed opacity-75">{page.description}</p>}

        <div className="mt-8 flex w-full flex-col gap-3">
          {page.blocks.map((b) => {
            const d = b.data as Record<string, unknown>;
            switch (b.type) {
              case "button": {
                const href = hrefFor(b.id);
                return (
                  <a
                    key={b.id}
                    href={href ?? undefined}
                    rel="noopener nofollow"
                    className="flex min-h-[56px] items-center justify-center rounded-[16px] px-5 text-[0.98rem] font-semibold transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={outline ? { border: `2px solid ${th.fg}`, color: th.fg, outlineColor: th.accent } : { background: th.fg, color: th.bg, outlineColor: th.accent }}
                  >
                    {String(d.label)}
                  </a>
                );
              }
              case "text":
                return (
                  <p key={b.id} className={`whitespace-pre-line text-[0.95rem] leading-relaxed opacity-85 ${d.align === "left" ? "text-left" : "text-center"}`}>
                    {String(d.text)}
                  </p>
                );
              case "image": {
                const href = hrefFor(b.id);
                // eslint-disable-next-line @next/next/no-img-element
                const img = <img src={mediaUrl(String(d.assetId))} alt={String(d.alt ?? "")} loading="lazy" className="w-full rounded-[18px] object-cover" />;
                return href ? (
                  <a key={b.id} href={href} rel="noopener nofollow">
                    {img}
                  </a>
                ) : (
                  <div key={b.id}>{img}</div>
                );
              }
              case "video":
                return (
                  <figure key={b.id}>
                    <video src={mediaUrl(String(d.assetId))} controls playsInline preload="metadata" className="w-full rounded-[18px] bg-black" />
                    {typeof d.caption === "string" && <figcaption className="mt-2 text-sm opacity-70">{d.caption}</figcaption>}
                  </figure>
                );
              case "social_links":
                return (
                  <ul key={b.id} className="flex flex-wrap justify-center gap-2">
                    {(d.links as { network: string; url: string }[]).map((l, i) => {
                      const href = hrefFor(b.id, i);
                      return (
                        <li key={i}>
                          <a href={href ?? undefined} rel="noopener nofollow me" className="inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-semibold" style={{ border: `1.5px solid ${th.fg}33` }}>
                            {NET_LABEL[l.network] ?? l.network}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                );
              case "image_grid":
                return (
                  <div key={b.id} className="grid grid-cols-3 gap-1.5">
                    {(d.items as { assetId: string; alt?: string; url?: string }[]).map((it, i) => {
                      // eslint-disable-next-line @next/next/no-img-element
                      const img = <img src={mediaUrl(it.assetId)} alt={it.alt ?? ""} loading="lazy" className="aspect-square w-full rounded-[10px] object-cover" />;
                      const href = it.url ? hrefFor(b.id, i) : null;
                      return href ? (
                        <a key={i} href={href} rel="noopener nofollow">
                          {img}
                        </a>
                      ) : (
                        <div key={i}>{img}</div>
                      );
                    })}
                  </div>
                );
              case "shop_grid":
                return null; // rendered below as its own section
            }
          })}
        </div>

        {shopTitle && page.grid.length > 0 && (
          <section className="mt-10 w-full" aria-label={String((shopTitle.data as { title?: string }).title ?? "Shop")}>
            {(shopTitle.data as { title?: string }).title && <h2 className="mb-3 text-left text-sm font-bold uppercase tracking-[0.14em] opacity-70">{(shopTitle.data as { title?: string }).title}</h2>}
            <div className="grid grid-cols-3 gap-1.5">
              {page.grid.map((g) => (
                <a key={g.id} href={hrefFor(g.id) ?? undefined} rel="noopener nofollow sponsored" className="group relative block overflow-hidden rounded-[10px]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(g.imageAssetId)} alt="" loading="lazy" className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                </a>
              ))}
            </div>
          </section>
        )}

        {!compact && !hidePoweredBy && (
          <p className="mt-14 text-xs opacity-50">
            Erstellt mit <a href="/" className="underline underline-offset-2">Postfino</a>
          </p>
        )}
      </div>
    </div>
  );
}
