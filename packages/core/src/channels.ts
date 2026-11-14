import { and, eq, isNull, sql, schema, type Db } from "@sichttakt/db";
import { AppError, type CapabilityState, type Platform } from "@sichttakt/shared";
import {
  capabilityFor,
  InstagramAdapter,
  FacebookPageAdapter,
  SandboxAdapter,
  LinkedInAdapter,
  TikTokAdapter,
  YouTubeAdapter,
  GoogleBusinessAdapter,
  XAdapter,
  ThreadsAdapter,
  PinterestAdapter,
  BlueskyAdapter,
  MastodonAdapter,
  NotificationOnlyAdapter,
  NOTIFICATION_ONLY_PLATFORMS,
  ProviderError,
  type MastodonAppStore,
  type CapabilityKey,
  type ChannelAuth,
  type ConnectedAccount,
  type PlatformAdapter,
} from "@sichttakt/social-adapters";
import type { AppConfig } from "@sichttakt/config";
import { createHash } from "node:crypto";
import { decrypt, encrypt, randomToken, sha256, type Keyring } from "./crypto";
import { assertPublicUrl } from "./net-guard";
import { loadWorkspace, authorize } from "./tenancy";
import { assertLimit } from "./entitlements";
import { audit } from "./audit";
import { emitEvent } from "./webhooks";
import type { Actor } from "./rbac";

// ── Adapter registry ──
/** Env variables each platform needs. A platform without them is reported as "not configured" and never called. */
export const PLATFORM_ENV: Partial<Record<Platform, string[]>> = {
  instagram_business: ["META_APP_ID", "META_APP_SECRET"],
  facebook_page: ["META_APP_ID", "META_APP_SECRET"],
  linkedin_profile: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  linkedin_page: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  youtube: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  google_business: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  x: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
  threads: ["THREADS_APP_ID", "THREADS_APP_SECRET"],
  pinterest: ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET"],
  bluesky: [],
  mastodon: [],
  instagram_personal: [],
  facebook_group: [],
  substack: [],
};
/** Platforms with an adapter (connectable when configured). */
export const CONNECTABLE_PLATFORMS = Object.keys(PLATFORM_ENV) as Platform[];

export function isPlatformConfigured(config: AppConfig, platform: Platform) {
  const env = PLATFORM_ENV[platform];
  if (!env) return false;
  if (platform === "mastodon") return config.MASTODON_ENABLED === "true";
  if (platform === "bluesky") return config.BLUESKY_ENABLED === "true";
  if ((NOTIFICATION_ONLY_PLATFORMS as readonly string[]).includes(platform)) return true;
  return env.every((k) => Boolean((config as Record<string, unknown>)[k]));
}

/** Mastodon OAuth apps per instance, client secret encrypted with the keyring. */
export function dbMastodonStore(db: Db, ring: Keyring): MastodonAppStore {
  return {
    async get(instance, redirectUri) {
      const rows = await db.select().from(schema.oauthClientApps).where(and(eq(schema.oauthClientApps.platform, "mastodon"), eq(schema.oauthClientApps.instance, instance)));
      const r = redirectUri ? rows.find((x) => x.redirectUri === redirectUri) : rows[0];
      return r ? { clientId: r.clientId, clientSecret: decrypt(ring, r.clientSecretEnc) } : null;
    },
    async save(instance, redirectUri, app) {
      const enc = encrypt(ring, app.clientSecret);
      await db.insert(schema.oauthClientApps).values({ platform: "mastodon", instance, redirectUri, clientId: app.clientId, clientSecretEnc: enc.value, keyVersion: enc.version, scopes: app.scopes }).onConflictDoNothing();
    },
  };
}

export class AdapterRegistry {
  private readonly cache = new Map<Platform, PlatformAdapter>();
  constructor(
    private readonly config: AppConfig,
    overrides: Partial<Record<Platform, PlatformAdapter>> = {},
    private readonly deps: { db?: Db; ring?: Keyring } = {},
  ) {
    for (const [k, v] of Object.entries(overrides)) this.cache.set(k as Platform, v!);
  }
  get(platform: Platform): PlatformAdapter {
    const hit = this.cache.get(platform);
    if (hit) return hit;
    const c = this.config;
    if (platform !== "sandbox" && !isPlatformConfigured(c, platform)) {
      const env = PLATFORM_ENV[platform];
      throw new AppError(env ? "PROVIDER_NOT_CONFIGURED" : "CAPABILITY_NOT_SUPPORTED", env ? `${platform} developer app is not configured (${env.join(" / ")})` : `No adapter for ${platform} (notification mode only)`);
    }
    let a: PlatformAdapter;
    switch (platform) {
      case "sandbox":
        a = new SandboxAdapter();
        break;
      case "instagram_business":
        a = new InstagramAdapter({ appId: c.META_APP_ID!, appSecret: c.META_APP_SECRET!, graphVersion: c.META_GRAPH_VERSION, configId: c.META_CONFIG_ID });
        break;
      case "facebook_page":
        a = new FacebookPageAdapter({ appId: c.META_APP_ID!, appSecret: c.META_APP_SECRET!, graphVersion: c.META_GRAPH_VERSION, configId: c.META_FB_CONFIG_ID });
        break;
      case "linkedin_profile":
      case "linkedin_page":
        a = new LinkedInAdapter(platform, { clientId: c.LINKEDIN_CLIENT_ID!, clientSecret: c.LINKEDIN_CLIENT_SECRET!, version: c.LINKEDIN_API_VERSION });
        break;
      case "tiktok":
        a = new TikTokAdapter({ clientKey: c.TIKTOK_CLIENT_KEY!, clientSecret: c.TIKTOK_CLIENT_SECRET! });
        break;
      case "youtube":
        a = new YouTubeAdapter({ clientId: c.GOOGLE_CLIENT_ID!, clientSecret: c.GOOGLE_CLIENT_SECRET! });
        break;
      case "google_business":
        a = new GoogleBusinessAdapter({ clientId: c.GOOGLE_CLIENT_ID!, clientSecret: c.GOOGLE_CLIENT_SECRET! });
        break;
      case "x":
        a = new XAdapter({ clientId: c.X_CLIENT_ID!, clientSecret: c.X_CLIENT_SECRET! });
        break;
      case "threads":
        a = new ThreadsAdapter({ appId: c.THREADS_APP_ID!, appSecret: c.THREADS_APP_SECRET! });
        break;
      case "pinterest":
        a = new PinterestAdapter({ appId: c.PINTEREST_APP_ID!, appSecret: c.PINTEREST_APP_SECRET!, apiBase: c.PINTEREST_API_BASE });
        break;
      case "bluesky":
        a = new BlueskyAdapter();
        break;
      case "instagram_personal":
      case "facebook_group":
      case "substack":
        a = new NotificationOnlyAdapter(platform);
        break;
      case "mastodon":
        if (!this.deps.db || !this.deps.ring) throw new AppError("PROVIDER_NOT_CONFIGURED", "Mastodon needs the database app store");
        a = new MastodonAdapter({
          store: dbMastodonStore(this.deps.db, this.deps.ring),
          appName: "Postfino",
          website: c.APP_URL,
          assertPublicHost: (host) => assertPublicUrl(`https://${host}/`, c.NODE_ENV !== "production"),
        });
        break;
      default:
        throw new AppError("CAPABILITY_NOT_SUPPORTED", `No adapter for ${platform} (notification mode only)`);
    }
    this.cache.set(platform, a);
    return a;
  }
}

/** Effective capability: channel override row > platform row in DB (set after live PoC) > code default. */
export async function effectiveCapability(db: Db, platform: Platform, channelId: string | null, key: CapabilityKey): Promise<CapabilityState> {
  const rows = await db
    .select()
    .from(schema.channelCapabilities)
    .where(
      and(
        eq(schema.channelCapabilities.platform, platform),
        eq(schema.channelCapabilities.capability, key),
        channelId ? sql`(${schema.channelCapabilities.channelId} = ${channelId} or ${schema.channelCapabilities.channelId} is null)` : isNull(schema.channelCapabilities.channelId),
      ),
    );
  const ch = rows.find((r) => r.channelId);
  const pf = rows.find((r) => !r.channelId);
  return (ch ?? pf)?.state ?? capabilityFor(platform, key).state;
}

// ── OAuth connect ──
export async function beginConnect(db: Db, registry: AdapterRegistry, actor: Actor, p: { workspaceId: string; platform: Platform; redirectUri: string; redirectAfter?: string; instance?: string }) {
  await loadWorkspace(db, actor, p.workspaceId, "channels.connect");
  await assertLimit(db, actor.organizationId, "channels");
  const adapter = registry.get(p.platform);
  if (adapter.connectMode === "credentials") throw new AppError("VALIDATION_FAILED", "This platform is connected with credentials, not OAuth");
  if (adapter.connectMode === "manual") throw new AppError("VALIDATION_FAILED", "no_publishing_api_create_reminder_channel");
  if (adapter.connectMode === "oauth_instance" && !p.instance) throw new AppError("VALIDATION_FAILED", "instance_required");
  const state = randomToken(24);
  // PKCE (RFC 7636, S256). The verifier lives 15 minutes, is single-use and only valid together with the state.
  const codeVerifier = adapter.connectMode === "oauth_pkce" ? randomToken(48) : null;
  const codeChallenge = codeVerifier ? createHash("sha256").update(codeVerifier).digest("base64url") : undefined;
  await db.insert(schema.oauthStates).values({
    stateHash: sha256(state),
    organizationId: actor.organizationId,
    workspaceId: p.workspaceId,
    platform: p.platform,
    userId: actor.kind === "user" ? actor.userId : null,
    apiKeyId: actor.kind === "api_key" ? actor.apiKeyId : null,
    redirectAfter: p.redirectAfter,
    codeVerifier,
    instance: p.instance ?? null,
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });
  try {
    return { url: await adapter.buildAuthUrl({ state, redirectUri: p.redirectUri, codeChallenge, instance: p.instance }) };
  } catch (e) {
    if (e instanceof ProviderError) throw new AppError("VALIDATION_FAILED", e.message, { provider_code: e.providerCode });
    throw e;
  }
}

export async function completeConnect(db: Db, ring: Keyring, registry: AdapterRegistry, p: { state: string; code: string; redirectUri: string }) {
  const [st] = await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.stateHash, sha256(p.state)));
  if (!st || st.usedAt || st.expiresAt < new Date()) throw new AppError("VALIDATION_FAILED", "invalid_or_expired_oauth_state");
  await db.update(schema.oauthStates).set({ usedAt: new Date() }).where(eq(schema.oauthStates.id, st.id));
  const adapter = registry.get(st.platform);
  const accounts = await adapter.exchangeCode({ code: p.code, redirectUri: p.redirectUri, codeVerifier: st.codeVerifier ?? undefined, instance: st.instance ?? undefined });
  if (accounts.length === 0) throw new AppError("VALIDATION_FAILED", "no_eligible_accounts");
  const out = [];
  for (const acc of accounts) out.push(await upsertChannel(db, ring, { organizationId: st.organizationId, workspaceId: st.workspaceId, platform: st.platform, account: acc, userId: st.userId, apiKeyId: st.apiKeyId, isSandbox: adapter.isMock }));
  return { channels: out, redirectAfter: st.redirectAfter };
}

/**
 * Reminder-only channel (no publishing API: Instagram personal, Facebook groups, Substack). Created by name;
 * nothing is sent to the network. Posts to it are always notification mode.
 */
export async function createManualChannel(db: Db, ring: Keyring, actor: Actor, p: { workspaceId: string; platform: Platform; displayName: string; username?: string }) {
  await loadWorkspace(db, actor, p.workspaceId, "channels.connect");
  await assertLimit(db, actor.organizationId, "channels");
  if (!(NOTIFICATION_ONLY_PLATFORMS as readonly string[]).includes(p.platform)) throw new AppError("VALIDATION_FAILED", "platform_has_api_use_oauth");
  const displayName = p.displayName.trim().slice(0, 80);
  if (!displayName) throw new AppError("VALIDATION_FAILED", "name_required");
  const username = p.username?.trim().replace(/^@/, "").slice(0, 80) || undefined;
  return upsertChannel(db, ring, {
    organizationId: actor.organizationId,
    workspaceId: p.workspaceId,
    platform: p.platform,
    userId: actor.kind === "user" ? actor.userId : null,
    apiKeyId: actor.kind === "api_key" ? actor.apiKeyId : null,
    account: { externalId: `manual:${(username ?? displayName).toLowerCase()}`, displayName, username, accessToken: "notification-only", grantedScopes: ["notification"], meta: { manual: true } },
  });
}

/** Credential-based connect (Bluesky app password). The password is passed through once and never stored or logged. */
export async function connectWithCredentials(db: Db, ring: Keyring, registry: AdapterRegistry, actor: Actor, p: { workspaceId: string; platform: Platform; identifier: string; password: string; service?: string }) {
  await loadWorkspace(db, actor, p.workspaceId, "channels.connect");
  await assertLimit(db, actor.organizationId, "channels");
  const adapter = registry.get(p.platform);
  if (adapter.connectMode !== "credentials" || !adapter.connectWithCredentials) throw new AppError("VALIDATION_FAILED", "This platform is connected via OAuth");
  if (p.service) await assertPublicUrl(p.service);
  let accounts: ConnectedAccount[];
  try {
    accounts = await adapter.connectWithCredentials({ identifier: p.identifier.trim(), password: p.password.trim(), service: p.service });
  } catch (e) {
    if (e instanceof ProviderError) throw new AppError("VALIDATION_FAILED", e.message, { provider_code: e.providerCode });
    throw e;
  }
  const out = [];
  for (const acc of accounts) out.push(await upsertChannel(db, ring, { organizationId: actor.organizationId, workspaceId: p.workspaceId, platform: p.platform, account: acc, userId: actor.kind === "user" ? actor.userId : null, apiKeyId: actor.kind === "api_key" ? actor.apiKeyId : null }));
  return out;
}

export async function upsertChannel(
  db: Db,
  ring: Keyring,
  p: { organizationId: string; workspaceId: string; platform: Platform; account: ConnectedAccount; userId?: string | null; apiKeyId?: string | null; isSandbox?: boolean },
) {
  const values = {
    organizationId: p.organizationId,
    workspaceId: p.workspaceId,
    platform: p.platform,
    externalId: p.account.externalId,
    displayName: p.account.displayName,
    username: p.account.username,
    avatarUrl: p.account.avatarUrl,
    status: "active" as const,
    isSandbox: p.isSandbox ?? false,
    grantedScopes: p.account.grantedScopes,
    meta: p.account.meta,
    connectedByUserId: p.userId ?? null,
    connectedViaApiKeyId: p.apiKeyId ?? null,
    disconnectedAt: null,
    lastError: null,
    updatedAt: new Date(),
  };
  const [ch] = await db
    .insert(schema.channels)
    .values(values)
    .onConflictDoUpdate({ target: [schema.channels.workspaceId, schema.channels.platform, schema.channels.externalId], set: values })
    .returning();
  const at = encrypt(ring, p.account.accessToken);
  const rt = p.account.refreshToken ? encrypt(ring, p.account.refreshToken).value : null;
  const credValues = { organizationId: p.organizationId, channelId: ch!.id, accessTokenEnc: at.value, refreshTokenEnc: rt, keyVersion: at.version, expiresAt: p.account.tokenExpiresAt ?? null, revokedAt: null, updatedAt: new Date() };
  await db.insert(schema.channelCredentials).values(credValues).onConflictDoUpdate({ target: schema.channelCredentials.channelId, set: credValues });
  await audit(db, { organizationId: p.organizationId, workspaceId: p.workspaceId, actorType: p.apiKeyId ? "api_key" : "user", actorUserId: p.userId ?? undefined, actorApiKeyId: p.apiKeyId ?? undefined, action: "channel.connected", targetType: "channel", targetId: ch!.id, metadata: { platform: p.platform, scopes: p.account.grantedScopes } });
  await emitEvent(db, { organizationId: p.organizationId, workspaceId: p.workspaceId, event: "account.connected", data: { account_id: ch!.id, platform: p.platform, display_name: ch!.displayName } });
  return publicChannelView(ch!);
}

/**
 * Disconnect: revoke credential immediately (worker refuses to publish afterwards), cancel queued targets,
 * best-effort revoke at the provider.
 */
export async function disconnectChannel(db: Db, ring: Keyring, registry: AdapterRegistry, actor: Actor, channelId: string) {
  const ch = await getChannel(db, actor, channelId, "channels.connect");
  const [cred] = await db.select().from(schema.channelCredentials).where(eq(schema.channelCredentials.channelId, ch.id));
  await db.transaction(async (tx) => {
    await tx.update(schema.channelCredentials).set({ revokedAt: new Date(), accessTokenEnc: "revoked", refreshTokenEnc: null }).where(eq(schema.channelCredentials.channelId, ch.id));
    await tx.update(schema.channels).set({ status: "disconnected", disconnectedAt: new Date(), updatedAt: new Date() }).where(eq(schema.channels.id, ch.id));
    await tx
      .update(schema.postTargets)
      .set({ status: "CANCELLED", errorCode: "CHANNEL_DISCONNECTED", updatedAt: new Date() })
      .where(and(eq(schema.postTargets.channelId, ch.id), sql`${schema.postTargets.status} in ('DRAFT','PENDING_APPROVAL','APPROVED','SCHEDULED','FAILED_RETRYABLE','PREPARING_MEDIA')`));
  });
  if (cred && cred.accessTokenEnc !== "revoked" && !ch.isSandbox) {
    try {
      await registry.get(ch.platform).disconnect({ accessToken: decrypt(ring, cred.accessTokenEnc), externalId: ch.externalId, meta: ch.meta });
    } catch {
      /* provider-side revoke is best effort; local revoke already effective */
    }
  }
  await audit(db, { organizationId: actor.organizationId, workspaceId: ch.workspaceId, actor, action: "channel.disconnected", targetType: "channel", targetId: ch.id });
  await emitEvent(db, { organizationId: actor.organizationId, workspaceId: ch.workspaceId, event: "account.disconnected", data: { account_id: ch.id, platform: ch.platform } });
}

export async function getChannel(db: Db, actor: Actor, channelId: string, permission: "channels.read" | "channels.connect" = "channels.read") {
  const [ch] = await db.select().from(schema.channels).where(and(eq(schema.channels.id, channelId), eq(schema.channels.organizationId, actor.organizationId)));
  if (!ch) throw new AppError("NOT_FOUND", "Account not found");
  authorize(actor, ch.workspaceId, permission, ch.organizationId);
  return ch;
}

export async function listChannels(db: Db, actor: Actor, workspaceId?: string) {
  const rows = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.organizationId, actor.organizationId), isNull(schema.channels.disconnectedAt), workspaceId ? eq(schema.channels.workspaceId, workspaceId) : undefined));
  return rows
    .filter((c) => {
      try {
        authorize(actor, c.workspaceId, "channels.read");
        return true;
      } catch {
        return false;
      }
    })
    .map(publicChannelView);
}

/** Worker-only: decrypted auth, refuses revoked / inactive channels. */
export async function getChannelAuthForPublish(db: Db, ring: Keyring, channelId: string, registry?: AdapterRegistry): Promise<{ channel: typeof schema.channels.$inferSelect; auth: ChannelAuth }> {
  const [row] = await db
    .select({ ch: schema.channels, cred: schema.channelCredentials })
    .from(schema.channels)
    .leftJoin(schema.channelCredentials, eq(schema.channelCredentials.channelId, schema.channels.id))
    .where(eq(schema.channels.id, channelId));
  if (!row || row.ch.status !== "active" || row.ch.disconnectedAt) throw new AppError("CHANNEL_NOT_ACTIVE", "Channel is not active");
  if (!row.cred || row.cred.revokedAt) throw new AppError("CHANNEL_NOT_ACTIVE", "Channel credentials revoked");
  const auth: ChannelAuth = { accessToken: decrypt(ring, row.cred.accessTokenEnc), refreshToken: row.cred.refreshTokenEnc ? decrypt(ring, row.cred.refreshTokenEnc) : undefined, externalId: row.ch.externalId, meta: row.ch.meta };
  // Short-lived tokens (Google 1 h, X 2 h, TikTok 24 h, Bluesky 2 h) are refreshed right before use.
  if (row.cred.expiresAt && row.cred.expiresAt.getTime() < Date.now() + 5 * 60_000) {
    if (!registry || !auth.refreshToken) {
      if (row.cred.expiresAt < new Date()) throw new AppError("CHANNEL_NOT_ACTIVE", "Channel token expired — reconnect required");
      return { channel: row.ch, auth };
    }
    const r = await registry.get(row.ch.platform).refreshToken(auth);
    await saveRefreshedToken(db, ring, row.cred.id, r);
    return { channel: row.ch, auth: { ...auth, accessToken: r.accessToken, refreshToken: r.refreshToken ?? auth.refreshToken } };
  }
  return { channel: row.ch, auth };
}

/** Persists a refreshed token (and a rotated refresh token, e.g. X / TikTok / Bluesky). */
export async function saveRefreshedToken(db: Db, ring: Keyring, credentialId: string, r: { accessToken: string; expiresAt?: Date; refreshToken?: string }) {
  const enc = encrypt(ring, r.accessToken);
  await db
    .update(schema.channelCredentials)
    .set({ accessTokenEnc: enc.value, keyVersion: enc.version, ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}), ...(r.refreshToken ? { refreshTokenEnc: encrypt(ring, r.refreshToken).value } : {}), updatedAt: new Date() })
    .where(eq(schema.channelCredentials.id, credentialId));
}

export const publicChannelView = (c: typeof schema.channels.$inferSelect) => ({
  id: c.id,
  workspace_id: c.workspaceId,
  platform: c.platform,
  display_name: c.displayName,
  username: c.username,
  avatar_url: c.avatarUrl,
  status: c.status,
  timezone: c.timezone,
  is_sandbox: c.isSandbox,
  granted_scopes: c.grantedScopes,
  connected_at: c.createdAt,
});
