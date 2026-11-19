import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { LEGAL_SITEMAP } from "@/lib/legal";

// Last content change per page (bump when the page text changes).
const HOME_UPDATED = "2026-11-19";
const LEGAL_UPDATED = "2026-11-18";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, lastModified: HOME_UPDATED, changeFrequency: "weekly", priority: 1 },
    ...LEGAL_SITEMAP.map((p) => ({ url: `${SITE_URL}${p}`, lastModified: LEGAL_UPDATED, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
