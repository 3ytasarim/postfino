import { getReview, publicBranding } from "@sichttakt/core";
import { Logo } from "@/components/logo";
import { Notice } from "@/components/ui";
import { ReviewDecision } from "@/components/review-decision";
import { getMessages, intlLocale, fmt } from "@/i18n";
import { services } from "@/lib/server";

export const metadata = { title: "Freigabe", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t, locale } = await getMessages();
  const review = await getReview(services().db, services().storage, token);
  if (!review)
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Notice tone="bad">{t.review.invalid}</Notice>
      </main>
    );
  const brand = await publicBranding(services().db, review.organizationId);
  const df = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "full", timeStyle: "short", timeZone: review.timezone });
  const items = review.media.filter((m) => m.role !== "cover");
  const cover = review.media.find((m) => m.role === "cover");
  return (
    <>
      <header className="border-b border-line bg-surface" style={brand.accentColor ? { borderBottomColor: brand.accentColor } : undefined}>
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          {brand.appName || brand.logoAssetId ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {brand.logoAssetId && <img src={`/review/${token}/logo`} alt="" className="h-9 w-auto" />}
              {brand.appName && <span className="font-display text-lg font-bold">{brand.appName}</span>}
            </>
          ) : (
            <Logo />
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
    <article className="space-y-6">
      <header>
        <p className="eyebrow">{t.review.title}</p>
        <h1 className="mt-2 text-3xl font-bold">{fmt(t.review.intro, { workspace: review.workspace })}</h1>
        <p className="mt-2 text-sm text-ink-2">
          {review.post.type.toUpperCase()} · v{review.post.version}
          {review.post.scheduledAt && ` · ${df.format(review.post.scheduledAt)} (${review.timezone})`}
        </p>
      </header>
      <section className="card space-y-4 p-6">
        {(items.length > 0 || cover) && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[...(cover ? [cover] : []), ...items].map((m, i) =>
              !m.url ? (
                <div key={i} className="grid aspect-square place-items-center rounded-[12px] bg-surface-2 text-xs text-ink-3">
                  {m.role} ({m.mime})
                </div>
              ) : m.kind === "video" ? (
                <video key={i} src={m.url} controls className="aspect-[9/16] w-full rounded-[12px] bg-black object-contain" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={m.url} alt={m.role} className="aspect-square w-full rounded-[12px] object-cover" />
              ),
            )}
          </div>
        )}
        <p className="whitespace-pre-wrap">{review.post.caption || "—"}</p>
        <ul className="flex flex-wrap gap-2">
          {review.targets.map((x, i) => (
            <li key={i} className="chip bg-surface-2 text-ink-2">
              {x.name}
            </li>
          ))}
        </ul>
        {review.notes.length > 0 && (
          <ul className="space-y-2 border-t border-line pt-4 text-sm">
            {review.notes.map((n, i) => (
              <li key={i} className="rounded-[10px] bg-puls-soft p-3 text-ink">
                {n.body}
              </li>
            ))}
          </ul>
        )}
      </section>
      <ReviewDecision token={token} t={t.review} accent={brand.accentColor} />
    </article>
      </main>
      {!brand.hidePoweredBy && <footer className="mx-auto max-w-3xl px-4 pb-10 text-xs text-ink-3">Postfino — {t.brand.by}</footer>}
    </>
  );
}
