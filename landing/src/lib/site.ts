// Where the calls to action lead: the Postfino web app (separate project).
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3610").replace(/\/$/, "");
export const REGISTER_URL = `${APP_URL}/login?mode=register`;
export const LOGIN_URL = `${APP_URL}/login`;

// Public website of the product and the company that operates it.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.postfino.com").replace(/\/$/, "");
export const COMPANY = "Bleibsichtbar LLC";
export const CONTACT_EMAIL = "bleibsichtbarwebseite@gmail.com";

export const NETWORKS = ["instagram_business", "facebook_page", "linkedin_page", "tiktok", "youtube", "threads", "x", "pinterest", "bluesky", "mastodon", "google_business"] as const;
