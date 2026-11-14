// Pure helpers shared by popup, context menus and tests. The extension never stores an API key or password:
// it only opens SichtTakt's /app/share page with prefilled fields; the user's normal login session does the rest.

export const DEFAULT_BASE = "https://app.sichttakt.de";
const LIMITS = { title: 200, url: 2000, text: 3000, image: 2000 };

/** Accepts only http(s) URLs; everything else (javascript:, data:, file:, chrome:) is dropped. */
export function safeHttpUrl(value) {
  try {
    const u = new URL(String(value ?? ""));
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

/** Base URL from the options page: must be https (http only for localhost development). */
export function normalizeBase(value) {
  const u = safeHttpUrl(value);
  if (!u) return DEFAULT_BASE;
  const x = new URL(u);
  const local = x.hostname === "localhost" || x.hostname === "127.0.0.1";
  if (x.protocol === "http:" && !local) return DEFAULT_BASE;
  return `${x.protocol}//${x.host}`;
}

export function buildShareUrl(base, { title, url, text, image } = {}) {
  const target = new URL("/app/share", normalizeBase(base));
  const put = (k, v, max) => {
    const s = String(v ?? "").trim().slice(0, max);
    if (s) target.searchParams.set(k, s);
  };
  put("title", title, LIMITS.title);
  put("url", safeHttpUrl(url), LIMITS.url);
  put("text", text, LIMITS.text);
  put("image", safeHttpUrl(image), LIMITS.image);
  return target.toString();
}
