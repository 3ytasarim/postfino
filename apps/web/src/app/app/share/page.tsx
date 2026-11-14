import Link from "next/link";
import { Lightbulb, PenSquare } from "lucide-react";
import { PageHeader, Notice } from "@/components/ui";
import { FormAction } from "@/components/form-action";
import { getMessages } from "@/i18n";
import { requireContext } from "@/lib/server";
import { createIdeaAction } from "../actions-content";

export const metadata = { title: "Teilen" };

const httpUrl = (u: string) => {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) ? x.toString() : "";
  } catch {
    return "";
  }
};

// Target of the browser extension and of "share to" links. Nothing is saved until the user submits:
// the extension only opens this page with prefilled fields (no API key or password in the extension).
export default async function SharePage({ searchParams }: { searchParams: Promise<{ title?: string; url?: string; text?: string; image?: string }> }) {
  const sp = await searchParams;
  await requireContext();
  const { t } = await getMessages();
  const s = t.share;
  const title = String(sp.title ?? "").slice(0, 200);
  const url = httpUrl(String(sp.url ?? "").slice(0, 2000));
  const image = httpUrl(String(sp.image ?? "").slice(0, 2000));
  const text = String(sp.text ?? "").slice(0, 3000);
  const caption = [text ? `„${text}“` : title, url].filter(Boolean).join("\n\n");
  return (
    <>
      <PageHeader title={s.title} subtitle={s.subtitle} />
      {!url && !text && !title && (
        <div className="mb-6">
          <Notice tone="info">{s.empty}</Notice>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <Lightbulb className="size-5" /> {s.asIdea}
          </h2>
          <FormAction action={createIdeaAction} submit={s.saveIdea} className="grid gap-3">
            <input name="title" required defaultValue={title || url} aria-label={t.ideasPage.titleField} className="input" />
            <textarea name="body" rows={5} defaultValue={text} aria-label={t.ideasPage.body} className="input" />
            <textarea name="links" rows={2} defaultValue={[url, image].filter(Boolean).join("\n")} aria-label={t.ideasPage.links} className="input font-mono text-sm" />
            <input name="tags" defaultValue="extension" aria-label={t.ideasPage.tags} className="input" />
          </FormAction>
          {image && <p className="mt-3 text-xs text-ink-3">{s.imageNote}</p>}
        </section>
        <section className="card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <PenSquare className="size-5" /> {s.asPost}
          </h2>
          <p className="whitespace-pre-wrap rounded-[12px] bg-surface-2 p-4 text-sm">{caption || "—"}</p>
          <Link href={`/app/compose/post?caption=${encodeURIComponent(caption)}`} className="btn btn-primary mt-4">
            {s.openComposer}
          </Link>
        </section>
      </div>
    </>
  );
}
