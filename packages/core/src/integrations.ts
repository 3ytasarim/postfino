import { and, eq, schema, type Db } from "@sichttakt/db";
import { AppError } from "@sichttakt/shared";
import type { AppConfig } from "@sichttakt/config";
import { decrypt, encrypt, type Keyring } from "./crypto";
import { authorize } from "./tenancy";
import { getEntitlements } from "./entitlements";
import { assertPublicUrl } from "./net-guard";
import { createMediaAsset, storeMediaContent, type MediaTools } from "./media";
import { audit } from "./audit";
import type { StorageDriver } from "./storage";
import type { Actor } from "./rbac";

// Integrations. Status is reported honestly per integration:
//   available        — works now (configured / built in)
//   connected        — organisation credential stored
//   not_connected    — can be connected by the customer
//   not_configured   — needs a Postfino developer app / key that is not set up yet
//   plan_locked      — not included in the current plan

export type IntegrationStatus = "available" | "connected" | "not_connected" | "not_configured" | "plan_locked";
export type IntegrationInfo = { id: string; name: string; category: "media" | "links" | "automation" | "content"; status: IntegrationStatus; how: string };

export async function listIntegrations(db: Db, config: AppConfig, actor: Actor): Promise<IntegrationInfo[]> {
  const ent = await getEntitlements(db, actor.organizationId);
  const creds = await db.select({ provider: schema.integrationCredentials.provider }).from(schema.integrationCredentials).where(eq(schema.integrationCredentials.organizationId, actor.organizationId));
  const has = (p: string) => creds.some((c) => c.provider === p);
  const api = ent.features.has("public_api") && ent.features.has("webhooks");
  return [
    { id: "unsplash", name: "Unsplash", category: "media", status: config.UNSPLASH_ACCESS_KEY ? "available" : "not_configured", how: "Fotos suchen und mit Namensnennung in die Medienbibliothek übernehmen (Unsplash API)." },
    { id: "bitly", name: "Bitly", category: "links", status: has("bitly") ? "connected" : "not_connected", how: "Eigenen Bitly-Token hinterlegen. Standard ist der Postfino-Kurzlink auf eigener Domain." },
    { id: "shortlinks", name: "Postfino Kurzlinks", category: "links", status: "available", how: "Kurzlinks auf eigener Domain mit Klickstatistik ohne Cookies/IP." },
    { id: "zapier", name: "Zapier", category: "automation", status: api ? "available" : "plan_locked", how: "Über Public API + signierte Webhooks (Zap „Webhooks by Zapier“). Eine gelistete Zapier-App ist nicht veröffentlicht." },
    { id: "make", name: "Make", category: "automation", status: api ? "available" : "plan_locked", how: "Über HTTP-Modul + Webhooks." },
    { id: "n8n", name: "n8n", category: "automation", status: api ? "available" : "plan_locked", how: "Über HTTP Request Node + Webhook Trigger." },
    { id: "wordpress", name: "WordPress", category: "content", status: "available", how: "Beiträge per RSS-Feed als Ideen übernehmen (Ideen → RSS)." },
    { id: "canva", name: "Canva", category: "media", status: "not_configured", how: "Canva Connect API erfordert eine geprüfte Canva-Integration (Antrag ausstehend)." },
    { id: "google_drive", name: "Google Drive / Photos", category: "media", status: "not_configured", how: "Google Picker benötigt ein verifiziertes Google-Cloud-Projekt (OAuth-Prüfung)." },
    { id: "dropbox", name: "Dropbox", category: "media", status: "not_configured", how: "Dropbox Chooser benötigt eine registrierte Dropbox-App." },
    { id: "onedrive", name: "OneDrive", category: "media", status: "not_configured", how: "OneDrive File Picker benötigt eine Azure-App-Registrierung." },
  ];
}

// ── Bitly ──
export async function connectBitly(db: Db, ring: Keyring, actor: Actor, token: string, http: typeof fetch = fetch) {
  authorize(actor, null, "org.manage");
  const res = await http("https://api-ssl.bitly.com/v4/user", { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new AppError("VALIDATION_FAILED", `bitly_token_rejected_${res.status}`);
  const user = (await res.json()) as { login?: string; default_group_guid?: string };
  const enc = encrypt(ring, token);
  const values = { organizationId: actor.organizationId, provider: "bitly", secretEnc: enc.value, keyVersion: enc.version, meta: { login: user.login ?? null, group: user.default_group_guid ?? null } };
  await db.insert(schema.integrationCredentials).values(values).onConflictDoUpdate({ target: [schema.integrationCredentials.organizationId, schema.integrationCredentials.provider], set: values });
  await audit(db, { organizationId: actor.organizationId, actor, action: "integration.connected", metadata: { provider: "bitly" } });
}

export async function disconnectIntegration(db: Db, actor: Actor, provider: string) {
  authorize(actor, null, "org.manage");
  await db.delete(schema.integrationCredentials).where(and(eq(schema.integrationCredentials.organizationId, actor.organizationId), eq(schema.integrationCredentials.provider, provider)));
  await audit(db, { organizationId: actor.organizationId, actor, action: "integration.disconnected", metadata: { provider } });
}

export async function bitlyShorten(db: Db, ring: Keyring, actor: Actor, url: string, http: typeof fetch = fetch) {
  const [c] = await db.select().from(schema.integrationCredentials).where(and(eq(schema.integrationCredentials.organizationId, actor.organizationId), eq(schema.integrationCredentials.provider, "bitly")));
  if (!c) throw new AppError("PROVIDER_NOT_CONFIGURED", "Bitly is not connected");
  const res = await http("https://api-ssl.bitly.com/v4/shorten", {
    method: "POST",
    headers: { authorization: `Bearer ${decrypt(ring, c.secretEnc)}`, "content-type": "application/json" },
    body: JSON.stringify({ long_url: url, ...(c.meta.group ? { group_guid: c.meta.group } : {}) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 429) throw new AppError("RATE_LIMITED", "bitly_rate_limited", undefined, 60);
  if (!res.ok) throw new AppError("PROVIDER_ERROR", `bitly_error_${res.status}`);
  return ((await res.json()) as { link: string }).link;
}

// ── Unsplash (attribution + download tracking per API guidelines) ──
export type UnsplashPhoto = { id: string; description: string | null; width: number; height: number; thumb: string; author: string; authorUrl: string; pageUrl: string };

export async function unsplashSearch(config: AppConfig, query: string, page = 1, http: typeof fetch = fetch): Promise<UnsplashPhoto[]> {
  if (!config.UNSPLASH_ACCESS_KEY) throw new AppError("PROVIDER_NOT_CONFIGURED", "UNSPLASH_ACCESS_KEY is not configured");
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const res = await http(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&page=${page}&per_page=24&content_filter=high`, { headers: { authorization: `Client-ID ${config.UNSPLASH_ACCESS_KEY}`, "accept-version": "v1" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new AppError("PROVIDER_ERROR", `unsplash_error_${res.status}`);
  const j = (await res.json()) as { results: { id: string; description: string | null; alt_description: string | null; width: number; height: number; urls: { small: string }; user: { name: string; links: { html: string } }; links: { html: string } }[] };
  return j.results.map((r) => ({ id: r.id, description: r.alt_description ?? r.description, width: r.width, height: r.height, thumb: r.urls.small, author: r.user.name, authorUrl: r.user.links.html, pageUrl: r.links.html }));
}

export async function unsplashImport(db: Db, storage: StorageDriver, config: AppConfig, actor: Actor, p: { workspaceId: string; photoId: string; tools?: MediaTools }, http: typeof fetch = fetch) {
  if (!config.UNSPLASH_ACCESS_KEY) throw new AppError("PROVIDER_NOT_CONFIGURED", "UNSPLASH_ACCESS_KEY is not configured");
  if (!/^[\w-]{4,40}$/.test(p.photoId)) throw new AppError("VALIDATION_FAILED", "invalid_photo_id");
  const headers = { authorization: `Client-ID ${config.UNSPLASH_ACCESS_KEY}`, "accept-version": "v1" };
  const photo = (await (await http(`https://api.unsplash.com/photos/${p.photoId}`, { headers, signal: AbortSignal.timeout(10_000) })).json()) as { urls: { regular: string }; links: { download_location: string; html: string }; user: { name: string; links: { html: string } }; alt_description: string | null };
  // Required by Unsplash: trigger the download endpoint when a photo is used.
  await http(photo.links.download_location, { headers, signal: AbortSignal.timeout(10_000) }).catch(() => {});
  const imgUrl = `${photo.urls.regular}${photo.urls.regular.includes("?") ? "&" : "?"}fm=jpg&q=85`;
  await assertPublicUrl(imgUrl);
  const res = await http(imgUrl, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new AppError("PROVIDER_ERROR", `unsplash_image_${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > 20 * 1024 * 1024) throw new AppError("MEDIA_INVALID", "image_too_large");
  const asset = await createMediaAsset(db, actor, { workspaceId: p.workspaceId, filename: `unsplash-${p.photoId}.jpg`, mimeType: "image/jpeg", sizeBytes: data.length, purpose: "image" });
  const stored = await storeMediaContent(db, storage, actor, asset.id, data, p.tools);
  const credit = `Foto von ${photo.user.name} auf Unsplash (${photo.links.html})`;
  await db.update(schema.mediaAssets).set({ altText: photo.alt_description ?? null, probe: { ...(stored.probe ?? {}), source: "unsplash", credit, authorUrl: photo.user.links.html } }).where(eq(schema.mediaAssets.id, stored.id));
  return { asset: stored, credit };
}
