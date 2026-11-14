import { z } from "zod";

// Single validated view of process.env. Secrets never have defaults; optional provider keys stay
// undefined so the UI can show "nicht konfiguriert" instead of pretending a connection works.

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("postgres://sichttakt:sichttakt@127.0.0.1:54347/sichttakt"),
  APP_URL: z.string().url().default("http://localhost:3610"),
  API_URL: z.string().url().default("http://localhost:3611"),
  /** Base of the OAuth redirect URI registered at the networks (defaults to API_URL). Meta only accepts HTTPS, so in
   *  local development this points at the HTTPS dev proxy (scripts/dev-https-proxy.mjs → https://localhost:3612). */
  OAUTH_REDIRECT_BASE: z.string().url().optional(),
  /** Comma separated `version:base64key` list; first entry encrypts, all entries decrypt (rotation). */
  ENCRYPTION_KEYS: z.string().optional(),
  SESSION_SECRET: z.string().optional(),

  /** "Sign in with Google" (OpenID Connect, web client). Falls back to GOOGLE_CLIENT_ID/SECRET when unset. */
  AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** "Sign in with Apple": Services ID, team, key id and the .p8 private key (PEM, \n allowed). */
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),

  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v27.0"),
  /** Instagram API with Unified Login: the login configuration id (App Dashboard → Instagram API → Unified login). */
  META_CONFIG_ID: z.string().optional(),
  /** Facebook Pages: optional Facebook Login for Business configuration of the Pages use case. */
  META_FB_CONFIG_ID: z.string().optional(),

  /** Public HTTPS base where Meta can fetch media (Hetzner Object Storage / CDN). Required for live publishing. */
  MEDIA_PUBLIC_BASE_URL: z.string().url().optional(),
  MEDIA_STORAGE_DIR: z.string().default(".data/media"),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  WORKER_POLL_MS: z.coerce.number().int().positive().default(2000),

  /** smtp(s)://user:pass@host:port — without it mails go to the dev outbox (.data/mail) and are NOT delivered. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("SichtTakt <no-reply@sichttakt.invalid>"),

  /** local (dev) | s3 (Hetzner Object Storage or any S3-compatible endpoint) */
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("eu-central"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  /** Optional media tooling. Unset = feature reported as not_configured (never silently skipped). */
  FFPROBE_PATH: z.string().optional(),
  /** Needed for option B (cover baked into the video). */
  FFMPEG_PATH: z.string().optional(),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),

  /** AI assistant (Claude API). Unset = feature shown as not configured; nothing is simulated. */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Project default per CLAUDE.md; change without code edits. */
  AI_MODEL: z.string().default("claude-sonnet-4-6"),

  /** Channel developer apps (Sprint 6). Unset = platform shown as "nicht konfiguriert"; no calls are made. */
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  /** LinkedIn-Version header (YYYYMM). Each version is supported for about one year. */
  LINKEDIN_API_VERSION: z.string().default("202510"),
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  /** Google Cloud OAuth client — YouTube Data API v3 and Business Profile APIs. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** X API v2 OAuth 2.0 client (paid API usage). */
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  THREADS_APP_ID: z.string().optional(),
  THREADS_APP_SECRET: z.string().optional(),
  PINTEREST_APP_ID: z.string().optional(),
  PINTEREST_APP_SECRET: z.string().optional(),
  /** https://api-sandbox.pinterest.com while the app only has trial access. */
  PINTEREST_API_BASE: z.string().url().optional(),
  /** Stripe (billing). Unset = billing shown as "nicht konfiguriert"; plans are then changed by a platform admin only. */
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_AGENCY: z.string().optional(),
  /** Stripe Tax (EU VAT). Requires Stripe Tax to be activated in the Stripe account. */
  STRIPE_AUTOMATIC_TAX: z.enum(["true", "false"]).default("false"),
  /** Enterprise enquiries (mailto on the billing page). Unset = no contact link is shown. */
  SALES_CONTACT_EMAIL: z.string().email().optional(),
  /** Trial days granted on first checkout (0 = none). */
  STRIPE_TRIAL_DAYS: z.coerce.number().int().min(0).max(60).default(14),
  /** Sandbox (MOCK) channels for development/QA. Off by default: customers never see mock channels. */
  SANDBOX_ENABLED: z.enum(["true", "false"]).default("false"),
  /** Federated platforms need no keys; set to "false" to hide them. */
  MASTODON_ENABLED: z.enum(["true", "false"]).default("true"),
  BLUESKY_ENABLED: z.enum(["true", "false"]).default("true"),

  /** Unsplash API access key (free developer app). Unset = integration shown as not configured. */
  UNSPLASH_ACCESS_KEY: z.string().optional(),
  /** Public base of short links on our own domain, e.g. https://sicht.link. Default: APP_URL/l */
  SHORTLINK_BASE_URL: z.string().url().optional(),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;
export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env && cached) return cached;
  const parsed = schema.parse(env);
  if (env === process.env) cached = parsed;
  return parsed;
}

export const isMetaConfigured = (c: AppConfig) => Boolean(c.META_APP_ID && c.META_APP_SECRET);

/** The OAuth redirect URI registered at every network; identical for the authorize request and the code exchange. */
export const oauthRedirectUri = (c: { API_URL: string; OAUTH_REDIRECT_BASE?: string }) => `${(c.OAUTH_REDIRECT_BASE ?? c.API_URL).replace(/\/$/, "")}/oauth/callback`;
