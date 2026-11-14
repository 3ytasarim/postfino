import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublishedPage, recordLinkEvent, publicBranding } from "@sichttakt/core";
import { StartPageView } from "@/components/start-page-view";
import { services } from "@/lib/server";

// Public Start Page: renders only the immutable published snapshot. Draft edits never leak here.
export const dynamic = "force-dynamic";

const load = cache((slug: string) => getPublishedPage(services().db, slug));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await load(slug);
  if (!p) return { title: "Nicht gefunden", robots: { index: false } };
  const { snapshot } = p;
  const image = snapshot.theme.avatarAssetId ? `/p/${p.page.slug}/m/${snapshot.theme.avatarAssetId}` : undefined;
  return {
    title: { absolute: snapshot.title },
    description: snapshot.description ?? undefined,
    robots: { index: true, follow: false },
    alternates: { canonical: `/p/${p.page.slug}` },
    openGraph: { title: snapshot.title, description: snapshot.description ?? undefined, type: "profile", images: image ? [image] : undefined },
    twitter: { card: "summary", title: snapshot.title, description: snapshot.description ?? undefined },
  };
}

export default async function PublicStartPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await load(slug);
  if (!p) notFound();
  const h = await headers();
  // Prefetches are not visits.
  if (!h.get("next-router-prefetch") && h.get("purpose") !== "prefetch") {
    await recordLinkEvent(services().db, { organizationId: p.page.organizationId, workspaceId: p.page.workspaceId, kind: "page_view", startPageId: p.page.id, userAgent: h.get("user-agent"), referrer: h.get("referer") }).catch(() => {});
  }
  const s = p.page.slug;
  const brand = await publicBranding(services().db, p.page.organizationId);
  return (
    <main>
      <StartPageView page={p.snapshot} mediaUrl={(id) => `/p/${s}/m/${id}`} hrefFor={(id, i) => `/go/${s}/${id}${i !== undefined ? `?i=${i}` : ""}`} hidePoweredBy={brand.hidePoweredBy} />
    </main>
  );
}
