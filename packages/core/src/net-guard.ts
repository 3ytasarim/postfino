import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// SSRF guard for outbound requests to customer-supplied URLs (webhooks, RSS, link previews).
// Rejects loopback, private, link-local, CGNAT and metadata ranges. Disabled only for local development.

function isPrivateV4(ip: string) {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function isPrivateV6(ip: string) {
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateV4(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}
export const isPrivateAddress = (ip: string) => (isIP(ip) === 6 ? isPrivateV6(ip) : isPrivateV4(ip));

export async function assertPublicUrl(rawUrl: string, allowPrivate = false): Promise<void> {
  const u = new URL(rawUrl);
  if (!["https:", "http:"].includes(u.protocol)) throw new Error("only http(s) URLs are allowed");
  if (allowPrivate) return;
  if (u.protocol !== "https:") throw new Error("only https URLs are allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error("URL resolves to a private or reserved address");
}
