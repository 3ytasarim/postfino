import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { LEGAL_SITEMAP } from "@/lib/legal";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", ...LEGAL_SITEMAP].map((p) => ({ url: `${SITE_URL}${p}`, changeFrequency: p ? "yearly" : "monthly", priority: p ? 0.3 : 1 }));
}
