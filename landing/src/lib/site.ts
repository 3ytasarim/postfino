// Where the calls to action lead: the Postfino web app (separate project). NEXT_PUBLIC_APP_URL is read at build time;
// a production build without it must never link to localhost — the app is served on the canonical domain
// (www.postfino.com/login, /app), so that is the production fallback.
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? (process.env.NODE_ENV === "production" ? "https://www.postfino.com" : "http://localhost:3610")).replace(/\/$/, "");
export const REGISTER_URL = `${APP_URL}/login?mode=register`;
export const LOGIN_URL = `${APP_URL}/login`;

// Public website of the product and the company that operates it.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.postfino.com").replace(/\/$/, "");
export const COMPANY = "Bleibsichtbar LLC";
// Product contact used across the website (legal texts keep the operator address OPERATOR.email).
export const CONTACT_EMAIL = "info@postfino.com";

export const NETWORKS = ["instagram_business", "facebook_page", "linkedin_page", "tiktok", "youtube", "threads", "x", "pinterest", "bluesky", "mastodon", "google_business"] as const;
