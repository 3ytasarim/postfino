import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Search engines and AI assistants (search, user-triggered fetches and training) are all welcome; everyone gets the same HTML.
const AI_AND_SEARCH_BOTS = [
  "Googlebot",
  "Google-Extended",
  "Bingbot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot",
  "Applebot-Extended",
  "DuckAssistBot",
  "MistralAI-User",
  "Meta-ExternalAgent",
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [...AI_AND_SEARCH_BOTS.map((userAgent) => ({ userAgent, allow: "/" })), { userAgent: "*", allow: "/" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
