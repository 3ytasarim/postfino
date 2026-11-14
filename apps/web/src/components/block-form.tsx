"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/app/app/actions";
import type { Messages } from "@/i18n/de";

const TYPES = ["button", "text", "image", "video", "social_links", "image_grid", "shop_grid"] as const;
type BlockType = (typeof TYPES)[number];
export type PickAsset = { id: string; name: string; kind: string };

/** Add / edit form for a Start Page block. Fields change with the block type; validation happens on the server. */
export function BlockForm({
  action,
  t,
  assets,
  hasShopGrid,
  block,
}: {
  action: (s: ActionResult, fd: FormData) => Promise<ActionResult>;
  t: Messages["startPageUi"];
  assets: PickAsset[];
  hasShopGrid: boolean;
  block?: { id: string; type: BlockType; data: Record<string, unknown> };
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [type, setType] = useState<BlockType>(block?.type ?? "button");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && !block) ref.current?.reset();
  }, [state, block]);
  const d = block?.data ?? {};
  const labels = t.types.split(",");
  const images = assets.filter((a) => a.kind === "image");
  const videos = assets.filter((a) => a.kind === "video");
  const uid = block?.id ?? "new";
  const field = (name: string, label: string, el: React.ReactNode) => (
    <div>
      <label className="label" htmlFor={`${uid}-${name}`}>
        {label}
      </label>
      {el}
    </div>
  );
  const picker = (list: PickAsset[], name: string, value?: string) =>
    list.length === 0 ? (
      <p className="text-sm text-warn">{t.noImages}</p>
    ) : (
      <select id={`${uid}-${name}`} name={name} className="input" defaultValue={value} required>
        {list.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    );

  return (
    <form ref={ref} action={formAction} className="space-y-3">
      {block && <input type="hidden" name="blockId" value={block.id} />}
      {block ? (
        <input type="hidden" name="type" value={type} />
      ) : (
        field(
          "type",
          t.blockType,
          <select id={`${uid}-type`} name="type" className="input" value={type} onChange={(e) => setType(e.target.value as BlockType)}>
            {TYPES.map((k, i) => (
              <option key={k} value={k} disabled={k === "shop_grid" && hasShopGrid}>
                {labels[i]}
              </option>
            ))}
          </select>,
        )
      )}

      {type === "button" && (
        <>
          {field("label", t.label, <input id={`${uid}-label`} name="label" className="input" maxLength={80} defaultValue={String(d.label ?? "")} required />)}
          {field("url", t.url, <input id={`${uid}-url`} name="url" type="url" className="input" placeholder="https://" defaultValue={String(d.url ?? "")} required />)}
        </>
      )}
      {type === "text" && (
        <>
          {field("text", t.text, <textarea id={`${uid}-text`} name="text" className="input min-h-[90px]" maxLength={1000} defaultValue={String(d.text ?? "")} required />)}
          {field(
            "align",
            t.align,
            <select id={`${uid}-align`} name="align" className="input" defaultValue={String(d.align ?? "center")}>
              <option value="center">{t.center}</option>
              <option value="left">{t.left}</option>
            </select>,
          )}
        </>
      )}
      {type === "image" && (
        <>
          {field("assetId", t.image, picker(images, "assetId", d.assetId as string | undefined))}
          {field("alt", t.alt, <input id={`${uid}-alt`} name="alt" className="input" maxLength={200} defaultValue={String(d.alt ?? "")} />)}
          {field("url", t.optionalUrl, <input id={`${uid}-url`} name="url" type="url" className="input" placeholder="https://" defaultValue={String(d.url ?? "")} />)}
        </>
      )}
      {type === "video" && (
        <>
          {field("assetId", "Video", picker(videos, "assetId", d.assetId as string | undefined))}
          {field("caption", t.caption, <input id={`${uid}-caption`} name="caption" className="input" maxLength={200} defaultValue={String(d.caption ?? "")} />)}
        </>
      )}
      {type === "social_links" && (
        <>
          {field(
            "links",
            t.socialLinks,
            <textarea
              id={`${uid}-links`}
              name="links"
              className="input min-h-[110px] font-mono text-sm"
              required
              defaultValue={((d.links as { network: string; url: string }[] | undefined) ?? []).map((l) => `${l.network} ${l.url}`).join("\n")}
              placeholder={"instagram https://instagram.com/marke\nemail hallo@marke.de"}
            />,
          )}
          <p className="text-xs text-ink-3">{t.networks}</p>
        </>
      )}
      {type === "image_grid" && (
        <fieldset>
          <legend className="label">{t.images}</legend>
          {images.length === 0 ? (
            <p className="text-sm text-warn">{t.noImages}</p>
          ) : (
            <div className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto">
              {images.map((a) => (
                <label key={a.id} className="relative cursor-pointer">
                  <input type="checkbox" name="assetIds" value={a.id} className="peer sr-only" defaultChecked={((d.items as { assetId: string }[] | undefined) ?? []).some((i) => i.assetId === a.id)} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/app/api/media/${a.id}`} alt={a.name} className="aspect-square w-full rounded-[8px] object-cover opacity-60 ring-takt peer-checked:opacity-100 peer-checked:ring-2 peer-focus-visible:ring-2" />
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
      {type === "shop_grid" && field("title", t.gridTitle, <input id={`${uid}-title`} name="title" className="input" maxLength={80} defaultValue={String(d.title ?? "")} />)}

      <div className="flex items-center gap-3">
        <button className="btn btn-primary !min-h-[40px]" disabled={pending}>
          {pending ? "…" : block ? t.edit : t.addBlock}
        </button>
        {state?.ok && <span className="text-sm font-medium text-ok">✓</span>}
        {state?.error && (
          <span role="alert" className="text-sm font-medium text-bad">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
