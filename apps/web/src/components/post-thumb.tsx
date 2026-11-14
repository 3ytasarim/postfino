import { Play } from "lucide-react";

/** Square post preview: image, or the first video frame with a play badge; "+n" for carousels. */
export function PostThumb({ thumb, size = 56 }: { thumb?: { assetId: string; kind: "image" | "video"; count: number }; size?: number }) {
  if (!thumb) return null;
  const src = `/app/api/media/${thumb.assetId}`;
  return (
    <span className="relative block shrink-0 overflow-hidden rounded-[10px] bg-surface-2" style={{ width: size, height: size }}>
      {thumb.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <video src={`${src}#t=0.5`} muted playsInline preload="metadata" className="size-full object-cover" aria-hidden />
      )}
      {thumb.kind === "video" && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-6 place-items-center rounded-full bg-black/55 text-white">
            <Play className="size-3 fill-current" aria-hidden />
          </span>
        </span>
      )}
      {thumb.count > 1 && <span className="absolute right-1 bottom-1 rounded-md bg-black/60 px-1 text-[0.65rem] font-bold text-white">+{thumb.count - 1}</span>}
    </span>
  );
}
