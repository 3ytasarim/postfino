import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import {
  ROLES,
  POST_STATUSES,
  PLATFORMS,
  POST_TYPES,
  PUBLISH_MODES,
  CAPABILITY_STATES,
  PLAN_CODES,
  CHANNEL_STATUSES,
  COVER_MODES,
} from "@sichttakt/shared";

// Tenancy model: organization (= tenant, agency or company) → workspaces (= brand / client) → channels.
// Every tenant-owned row carries organization_id; workspace-owned rows also carry workspace_id.
// Services must always filter by both (see packages/core/src/tenancy.ts); cross-tenant tests in tests/.

export const roleEnum = pgEnum("role", ROLES);
export const postStatusEnum = pgEnum("post_status", POST_STATUSES);
export const platformEnum = pgEnum("platform", PLATFORMS);
export const postTypeEnum = pgEnum("post_type", POST_TYPES);
export const publishModeEnum = pgEnum("publish_mode", PUBLISH_MODES);
export const capabilityStateEnum = pgEnum("capability_state", CAPABILITY_STATES);
export const planCodeEnum = pgEnum("plan_code", PLAN_CODES);
export const channelStatusEnum = pgEnum("channel_status", CHANNEL_STATUSES);
export const coverModeEnum = pgEnum("cover_mode", COVER_MODES);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const orgId = () => uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" });
const wsId = () => uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" });

// ───────────────────────── Identity ─────────────────────────

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  locale: text("locale").notNull().default("de"),
  timezone: text("timezone").notNull().default("Europe/Berlin"),
  totpSecretEnc: text("totp_secret_enc"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  notificationPrefs: jsonb("notification_prefs").$type<Record<string, boolean>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)]);

/** Sign-in identities from external providers (Google, Apple). `subject` is the provider's stable user id. */
export const userIdentities = pgTable("user_identities", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // google | apple
  subject: text("subject").notNull(),
  email: text("email"),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (t) => [uniqueIndex("user_identities_provider_subject_uq").on(t.provider, t.subject), index("user_identities_user_idx").on(t.userId)]);

/** Short-lived state of a social sign-in round trip (CSRF state, OIDC nonce, PKCE verifier). Single use. */
export const socialLoginStates = pgTable("social_login_states", {
  id: id(),
  stateHash: text("state_hash").notNull(),
  provider: text("provider").notNull(),
  nonce: text("nonce").notNull(),
  codeVerifier: text("code_verifier").notNull(),
  redirectAfter: text("redirect_after"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("social_login_states_state_uq").on(t.stateHash)]);

/**
 * Email one-time code that must be entered before a session is created (step-up after social sign-in).
 * Only hashes are stored; the browser holds the challenge token in an httpOnly cookie.
 */
export const loginChallenges = pgTable("login_challenges", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  codeHash: text("code_hash").notNull(),
  purpose: text("purpose").notNull().default("social_login"),
  attempts: integer("attempts").notNull().default(0),
  sends: integer("sends").notNull().default(1),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull().defaultNow(),
  redirectAfter: text("redirect_after"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("login_challenges_token_uq").on(t.tokenHash), index("login_challenges_user_idx").on(t.userId)]);

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  activeOrganizationId: uuid("active_organization_id"),
  activeWorkspaceId: uuid("active_workspace_id"),
  twoFactorPending: boolean("two_factor_pending").notNull().default(false),
  ip: text("ip"),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)]);

/** One-time email tokens: purpose = password_reset | email_verify. */
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull().default("password_reset"),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("pwreset_token_uq").on(t.tokenHash)]);

// ───────────────────────── Tenancy ─────────────────────────

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  kind: text("kind").notNull().default("agency"), // agency | company
  locale: text("locale").notNull().default("de"),
  timezone: text("timezone").notNull().default("Europe/Berlin"),
  country: text("country").notNull().default("DE"),
  vatId: text("vat_id"),
  dataRetentionDays: integer("data_retention_days").notNull().default(730),
  /** White-label (plan feature white_label): app name, logo, accent colour, custom domain + DNS verification. */
  branding: jsonb("branding").$type<{ appName?: string; logoAssetId?: string; accentColor?: string; hidePoweredBy?: boolean; customDomain?: string; domainToken?: string; domainVerifiedAt?: string }>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [uniqueIndex("organizations_slug_uq").on(t.slug)]);

export const workspaces = pgTable("workspaces", {
  id: id(),
  organizationId: orgId(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  logoAssetId: uuid("logo_asset_id"),
  timezone: text("timezone").notNull().default("Europe/Berlin"),
  locale: text("locale").notNull().default("de"),
  isClient: boolean("is_client").notNull().default(false),
  approvalRequired: boolean("approval_required").notNull().default(false),
  queuePaused: boolean("queue_paused").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [uniqueIndex("workspaces_org_slug_uq").on(t.organizationId, t.slug)]);

/** Role definitions. System roles are seeded (organization_id NULL); custom roles per tenant later. */
export const roles = pgTable("roles", {
  id: id(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  key: roleEnum("key").notNull(),
  name: text("name").notNull(),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

/** workspace_id NULL = organization-wide membership. */
export const memberships = pgTable("memberships", {
  id: id(),
  organizationId: orgId(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull(),
  channelIds: jsonb("channel_ids").$type<string[] | null>(), // null = all channels in scope
  inviteEmail: text("invite_email"),
  inviteTokenHash: text("invite_token_hash"),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("memberships_user_idx").on(t.userId),
  uniqueIndex("memberships_scope_uq").on(t.organizationId, t.userId, sql`coalesce(${t.workspaceId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
]);

// ───────────────────────── Channels ─────────────────────────

export const channelGroups = pgTable("channel_groups", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  name: text("name").notNull(),
  channelIds: jsonb("channel_ids").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

export const channels = pgTable("channels", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  platform: platformEnum("platform").notNull(),
  externalId: text("external_id").notNull(),
  displayName: text("display_name").notNull(),
  username: text("username"),
  avatarUrl: text("avatar_url"),
  timezone: text("timezone").notNull().default("Europe/Berlin"),
  status: channelStatusEnum("status").notNull().default("active"),
  isSandbox: boolean("is_sandbox").notNull().default(false),
  grantedScopes: jsonb("granted_scopes").$type<string[]>().notNull().default([]),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  connectedByUserId: uuid("connected_by_user_id"),
  connectedViaApiKeyId: uuid("connected_via_api_key_id"),
  lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("channels_ws_platform_ext_uq").on(t.workspaceId, t.platform, t.externalId),
  index("channels_org_idx").on(t.organizationId),
]);

/** Encrypted OAuth credentials. Never selected by API/UI code paths; only the worker/adapters decrypt. */
export const channelCredentials = pgTable("channel_credentials", {
  id: id(),
  organizationId: orgId(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc"),
  keyVersion: text("key_version").notNull(),
  tokenType: text("token_type").notNull().default("bearer"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("channel_credentials_channel_uq").on(t.channelId)]);

/** OAuth client registrations created at runtime for federated platforms (one per Mastodon instance). */
export const oauthClientApps = pgTable("oauth_client_apps", {
  id: id(),
  platform: platformEnum("platform").notNull(),
  instance: text("instance").notNull(),
  clientId: text("client_id").notNull(),
  clientSecretEnc: text("client_secret_enc").notNull(),
  keyVersion: text("key_version").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  scopes: text("scopes").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("oauth_client_apps_uq").on(t.platform, t.instance, t.redirectUri)]);

/** Versioned capability matrix (docs/PLATFORM_CAPABILITIES.md). channel_id NULL = platform default. */
export const channelCapabilities = pgTable("channel_capabilities", {
  id: id(),
  platform: platformEnum("platform").notNull(),
  channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
  capability: text("capability").notNull(),
  state: capabilityStateEnum("state").notNull(),
  matrixVersion: text("matrix_version").notNull(),
  note: text("note"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("channel_capabilities_uq").on(t.platform, sql`coalesce(${t.channelId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.capability)]);

export const oauthStates = pgTable("oauth_states", {
  id: id(),
  stateHash: text("state_hash").notNull(),
  organizationId: orgId(),
  workspaceId: wsId(),
  platform: platformEnum("platform").notNull(),
  userId: uuid("user_id"),
  apiKeyId: uuid("api_key_id"),
  redirectAfter: text("redirect_after"),
  codeVerifier: text("code_verifier"),
  /** Federated platforms (Mastodon): instance host the user chose. */
  instance: text("instance"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("oauth_states_hash_uq").on(t.stateHash)]);

// ───────────────────────── Brand & media ─────────────────────────

export const brandVoices = pgTable("brand_voices", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  dos: jsonb("dos").$type<string[]>().notNull().default([]),
  donts: jsonb("donts").$type<string[]>().notNull().default([]),
  examples: jsonb("examples").$type<string[]>().notNull().default([]),
  language: text("language").notNull().default("de"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const mediaAssets = pgTable("media_assets", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  kind: text("kind").notNull(), // image | video | document
  purpose: text("purpose").notNull().default("image"), // image | video | cover | document | logo
  status: text("status").notNull().default("pending_upload"), // pending_upload | processing | ready | rejected
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  storageKey: text("storage_key").notNull(),
  sha256: text("sha256"),
  width: integer("width"),
  height: integer("height"),
  durationMs: integer("duration_ms"),
  probe: jsonb("probe").$type<Record<string, unknown>>(),
  validationErrors: jsonb("validation_errors").$type<string[]>().notNull().default([]),
  altText: text("alt_text"),
  uploadedByUserId: uuid("uploaded_by_user_id"),
  uploadedViaApiKeyId: uuid("uploaded_via_api_key_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("media_assets_ws_idx").on(t.workspaceId), uniqueIndex("media_assets_key_uq").on(t.storageKey)]);

export const mediaVariants = pgTable("media_variants", {
  id: id(),
  organizationId: orgId(),
  assetId: uuid("asset_id").notNull().references(() => mediaAssets.id, { onDelete: "cascade" }),
  variant: text("variant").notNull(), // thumb | reels_9x16 | grid_3x4 | grid_1x1 | normalized_mp4
  mimeType: text("mime_type").notNull(),
  storageKey: text("storage_key").notNull(),
  width: integer("width"),
  height: integer("height"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("media_variants_uq").on(t.assetId, t.variant)]);

// ───────────────────────── Ideas ─────────────────────────

export const ideaBoards = pgTable("idea_boards", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  name: text("name").notNull(),
  columns: jsonb("columns").$type<{ id: string; name: string }[]>().notNull().default([]),
  createdAt: createdAt(),
});

export const contentIdeas = pgTable("content_ideas", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  boardId: uuid("board_id").references(() => ideaBoards.id, { onDelete: "set null" }),
  columnId: text("column_id"),
  position: integer("position").notNull().default(0),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  links: jsonb("links").$type<string[]>().notNull().default([]),
  mediaAssetIds: jsonb("media_asset_ids").$type<string[]>().notNull().default([]),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  source: text("source").notNull().default("manual"), // manual | rss | comment | extension | api
  sourceRef: text("source_ref"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("content_ideas_source_uq").on(t.workspaceId, t.source, t.sourceRef)]);

export const contentTags = pgTable("content_tags", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("content_tags_ws_name_uq").on(t.workspaceId, sql`lower(${t.name})`)]);

// ───────────────────────── Posts & publishing ─────────────────────────

export const posts = pgTable("posts", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  type: postTypeEnum("type").notNull(),
  status: postStatusEnum("status").notNull().default("DRAFT"),
  caption: text("caption").notNull().default(""),
  coverMode: coverModeEnum("cover_mode"),
  thumbOffsetMs: integer("thumb_offset_ms"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  scheduledTimezone: text("scheduled_timezone"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  externalRef: text("external_ref"),
  ideaId: uuid("idea_id"),
  currentVersion: integer("current_version").notNull().default(1),
  approvedVersion: integer("approved_version"),
  createdByUserId: uuid("created_by_user_id"),
  createdViaApiKeyId: uuid("created_via_api_key_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  index("posts_ws_status_idx").on(t.workspaceId, t.status),
  index("posts_ws_sched_idx").on(t.workspaceId, t.scheduledAt),
]);

export const postTargets = pgTable("post_targets", {
  id: id(),
  organizationId: orgId(),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  status: postStatusEnum("status").notNull().default("DRAFT"),
  publishMode: publishModeEnum("publish_mode").notNull().default("automatic"),
  captionOverride: text("caption_override"),
  options: jsonb("options").$type<Record<string, unknown>>().notNull().default({}),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  externalContainerId: text("external_container_id"),
  externalPostId: text("external_post_id"),
  permalink: text("permalink"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  attempts: integer("attempts").notNull().default(0),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("post_targets_post_channel_uq").on(t.postId, t.channelId)]);

export const postMedia = pgTable("post_media", {
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").notNull().references(() => mediaAssets.id, { onDelete: "restrict" }),
  organizationId: orgId(),
  role: text("role").notNull(), // item | video | cover
  position: integer("position").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.postId, t.assetId, t.role] })]);

export const postVersions = pgTable("post_versions", {
  id: id(),
  organizationId: orgId(),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  contentHash: text("content_hash").notNull(),
  changedByUserId: uuid("changed_by_user_id"),
  changedViaApiKeyId: uuid("changed_via_api_key_id"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("post_versions_uq").on(t.postId, t.version)]);

/** Weekly posting slots per channel (local wall-clock in channel timezone). */
export const scheduledSlots = pgTable("scheduled_slots", {
  id: id(),
  organizationId: orgId(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(), // 1 = Monday … 7 = Sunday (ISO)
  minuteOfDay: integer("minute_of_day").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("scheduled_slots_uq").on(t.channelId, t.weekday, t.minuteOfDay)]);

/** Durable job queue (Postgres SKIP LOCKED). dedup_key makes enqueue idempotent. */
export const queueItems = pgTable("queue_items", {
  id: id(),
  organizationId: uuid("organization_id"),
  kind: text("kind").notNull(), // publish_target | deliver_webhook | refresh_token | ...
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  dedupKey: text("dedup_key"),
  status: text("status").notNull().default("pending"), // pending | running | done | failed | dead
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lockedBy: text("locked_by"),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("queue_items_dedup_uq").on(t.dedupKey),
  index("queue_items_ready_idx").on(t.status, t.runAt),
]);

export const publishAttempts = pgTable("publish_attempts", {
  id: id(),
  organizationId: orgId(),
  postTargetId: uuid("post_target_id").notNull().references(() => postTargets.id, { onDelete: "cascade" }),
  queueItemId: uuid("queue_item_id"),
  attempt: integer("attempt").notNull(),
  step: text("step").notNull(), // validate | create_container | poll | publish | permalink
  outcome: text("outcome").notNull(), // ok | retryable_error | final_error | blocked
  request: jsonb("request").$type<Record<string, unknown>>(),
  response: jsonb("response").$type<Record<string, unknown>>(),
  errorCode: text("error_code"),
  durationMs: integer("duration_ms"),
  createdAt: createdAt(),
}, (t) => [index("publish_attempts_target_idx").on(t.postTargetId)]);

export const publishedPosts = pgTable("published_posts", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  postTargetId: uuid("post_target_id").notNull().references(() => postTargets.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id").notNull(),
  platform: platformEnum("platform").notNull(),
  externalPostId: text("external_post_id").notNull(),
  permalink: text("permalink"),
  coverUrlSent: text("cover_url_sent"),
  rawResponse: jsonb("raw_response").$type<Record<string, unknown>>(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("published_posts_target_uq").on(t.postTargetId), uniqueIndex("published_posts_ext_uq").on(t.platform, t.externalPostId)]);

// ───────────────────────── Approvals & collaboration ─────────────────────────

export const approvalRequests = pgTable("approval_requests", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  postVersion: integer("post_version").notNull(),
  status: text("status").notNull().default("open"), // open | approved | changes_requested | invalidated
  requestedByUserId: uuid("requested_by_user_id"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  reviewTokenHash: text("review_token_hash"),
  reviewTokenExpiresAt: timestamp("review_token_expires_at", { withTimezone: true }),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
  createdAt: createdAt(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const approvalDecisions = pgTable("approval_decisions", {
  id: id(),
  organizationId: orgId(),
  approvalRequestId: uuid("approval_request_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
  decidedByUserId: uuid("decided_by_user_id"),
  decidedViaApiKeyId: uuid("decided_via_api_key_id"),
  decision: text("decision").notNull(), // approved | changes_requested
  reviewerName: text("reviewer_name"), // portal reviewers without an account
  via: text("via").notNull().default("app"), // app | portal | api
  comment: text("comment"),
  createdAt: createdAt(),
});

export const internalNotes = pgTable("internal_notes", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
  ideaId: uuid("idea_id").references(() => contentIdeas.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").notNull(),
  body: text("body").notNull(),
  mentions: jsonb("mentions").$type<string[]>().notNull().default([]),
  visibleToClient: boolean("visible_to_client").notNull().default(false),
  createdAt: createdAt(),
});

// ───────────────────────── Community ─────────────────────────

export const commentThreads = pgTable("comment_threads", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  externalPostId: text("external_post_id").notNull(),
  status: text("status").notNull().default("open"), // open | resolved
  assignedUserId: uuid("assigned_user_id"),
  publishedPostId: uuid("published_post_id"),
  postPermalink: text("post_permalink"),
  postCaption: text("post_caption"),
  lastCommentAt: timestamp("last_comment_at", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("comment_threads_uq").on(t.channelId, t.externalPostId)]);

export const comments = pgTable("comments", {
  id: id(),
  organizationId: orgId(),
  threadId: uuid("thread_id").notNull().references(() => commentThreads.id, { onDelete: "cascade" }),
  externalCommentId: text("external_comment_id").notNull(),
  parentExternalId: text("parent_external_id"),
  authorName: text("author_name"),
  body: text("body").notNull(),
  isOwn: boolean("is_own").notNull().default(false),
  authoredByUserId: uuid("authored_by_user_id"),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("comments_ext_uq").on(t.threadId, t.externalCommentId)]);

export const savedReplies = pgTable("saved_replies", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

// ───────────────────────── Insights & reports ─────────────────────────

export const metricDefinitions = pgTable("metric_definitions", {
  key: text("key").primaryKey(),
  label: jsonb("label").$type<Record<string, string>>().notNull(),
  description: jsonb("description").$type<Record<string, string>>().notNull(),
  unit: text("unit").notNull().default("count"),
});

/** value NULL + available=false means the platform does not expose the metric (shown as N/A, never 0). */
export const analyticsSnapshots = pgTable("analytics_snapshots", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  publishedPostId: uuid("published_post_id"),
  metricKey: text("metric_key").notNull(),
  value: bigint("value", { mode: "number" }),
  available: boolean("available").notNull().default(true),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  sourcePlatform: platformEnum("source_platform").notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("analytics_channel_metric_idx").on(t.channelId, t.metricKey, t.collectedAt)]);

export const reports = pgTable("reports", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  title: text("title").notNull(),
  format: text("format").notNull(), // pdf | csv | md
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("pending"),
  storageKey: text("storage_key"),
  error: text("error"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: createdAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// ───────────────────────── Start Page & Shop Grid ─────────────────────────

export const startPages = pgTable("start_pages", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  theme: jsonb("theme").$type<Record<string, unknown>>().notNull().default({}),
  publishedVersion: integer("published_version"),
  draftVersion: integer("draft_version").notNull().default(1),
  description: text("description"),
  /** Immutable copy of theme + blocks at publish time; the public page renders only this. */
  publishedSnapshot: jsonb("published_snapshot").$type<Record<string, unknown> | null>(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("start_pages_slug_uq").on(t.slug)]);

export const startPageBlocks = pgTable("start_page_blocks", {
  id: id(),
  organizationId: orgId(),
  startPageId: uuid("start_page_id").notNull().references(() => startPages.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // button | text | image | video | social_links | image_grid | shop_grid
  position: integer("position").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const shopGridItems = pgTable("shop_grid_items", {
  id: id(),
  organizationId: orgId(),
  startPageId: uuid("start_page_id").notNull().references(() => startPages.id, { onDelete: "cascade" }),
  publishedPostId: uuid("published_post_id"),
  imageAssetId: uuid("image_asset_id"),
  targetUrl: text("target_url").notNull(),
  position: integer("position").notNull(),
  clicks: integer("clicks").notNull().default(0),
  createdAt: createdAt(),
});

// ───────────────────────── Public API ─────────────────────────

export const apiKeys = pgTable("api_keys", {
  id: id(),
  organizationId: orgId(),
  name: text("name").notNull(),
  environment: text("environment").notNull().default("live"), // live | test
  prefix: text("prefix").notNull(), // shown in UI, e.g. st_live_ab12cd34
  secretHash: text("secret_hash").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
  workspaceIds: jsonb("workspace_ids").$type<string[]>().notNull(),
  ipAllowlist: jsonb("ip_allowlist").$type<string[] | null>(),
  createdByUserId: uuid("created_by_user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  rotatedFromId: uuid("rotated_from_id"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("api_keys_prefix_uq").on(t.prefix), index("api_keys_org_idx").on(t.organizationId)]);

export const idempotencyKeys = pgTable("idempotency_keys", {
  id: id(),
  organizationId: orgId(),
  apiKeyId: uuid("api_key_id").notNull(),
  key: text("key").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  requestHash: text("request_hash").notNull(),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body"),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex("idempotency_uq").on(t.apiKeyId, t.key)]);

export const apiRequestLogs = pgTable("api_request_logs", {
  id: id(),
  organizationId: orgId(),
  apiKeyId: uuid("api_key_id").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  status: integer("status").notNull(),
  errorCode: text("error_code"),
  durationMs: integer("duration_ms").notNull(),
  ip: text("ip"),
  requestId: text("request_id").notNull(),
  createdAt: createdAt(),
}, (t) => [index("api_request_logs_org_time_idx").on(t.organizationId, t.createdAt)]);

export const webhookSubscriptions = pgTable("webhook_subscriptions", {
  id: id(),
  organizationId: orgId(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  events: jsonb("events").$type<string[]>().notNull(),
  secretEnc: text("secret_enc").notNull(),
  keyVersion: text("key_version").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdByApiKeyId: uuid("created_by_api_key_id"),
  createdAt: createdAt(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: id(),
  organizationId: orgId(),
  subscriptionId: uuid("subscription_id").notNull().references(() => webhookSubscriptions.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  eventId: text("event_id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("pending"), // pending | delivered | failed | dead
  attempts: integer("attempts").notNull().default(0),
  lastStatusCode: integer("last_status_code"),
  lastError: text("last_error"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("webhook_deliveries_uq").on(t.subscriptionId, t.eventId)]);

// ───────────────────────── Notifications, audit ─────────────────────────

export const notifications = pgTable("notifications", {
  id: id(),
  organizationId: orgId(),
  workspaceId: uuid("workspace_id"),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("notifications_user_idx").on(t.userId, t.readAt)]);

export const auditLogs = pgTable("audit_logs", {
  id: id(),
  organizationId: uuid("organization_id"),
  workspaceId: uuid("workspace_id"),
  actorUserId: uuid("actor_user_id"),
  actorApiKeyId: uuid("actor_api_key_id"),
  actorType: text("actor_type").notNull(), // user | api_key | system
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ip: text("ip"),
  createdAt: createdAt(),
}, (t) => [index("audit_logs_org_time_idx").on(t.organizationId, t.createdAt)]);

// ───────────────────────── Billing ─────────────────────────

export const subscriptionPlans = pgTable("subscription_plans", {
  code: planCodeEnum("code").primaryKey(),
  name: text("name").notNull(),
  monthlyPriceCents: integer("monthly_price_cents"),
  currency: text("currency").notNull().default("EUR"),
  limits: jsonb("limits").$type<Record<string, number | null>>().notNull(),
  features: jsonb("features").$type<string[]>().notNull(),
  isPublic: boolean("is_public").notNull().default(true),
  updatedAt: updatedAt(),
});

export const subscriptions = pgTable("subscriptions", {
  id: id(),
  organizationId: orgId(),
  planCode: planCodeEnum("plan_code").notNull(),
  status: text("status").notNull().default("trialing"), // trialing | active | past_due | cancelled
  limitOverrides: jsonb("limit_overrides").$type<Record<string, number | null>>().notNull().default({}),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
  externalCustomerId: text("external_customer_id"),
  externalSubscriptionId: text("external_subscription_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("subscriptions_org_uq").on(t.organizationId)]);

/** Provider webhook events, stored once (unique provider + event id) → idempotent processing. */
export const billingEvents = pgTable("billing_events", {
  id: id(),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  type: text("type").notNull(),
  organizationId: uuid("organization_id"),
  status: text("status").notNull().default("received"), // received | processed | ignored | failed
  error: text("error"),
  receivedAt: createdAt(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("billing_events_uq").on(t.provider, t.eventId)]);

export const invoices = pgTable("invoices", {
  id: id(),
  organizationId: orgId(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  number: text("number"),
  status: text("status").notNull(), // draft | open | paid | uncollectible | void
  amountDueCents: integer("amount_due_cents").notNull(),
  amountPaidCents: integer("amount_paid_cents").notNull(),
  currency: text("currency").notNull(),
  hostedUrl: text("hosted_url"),
  pdfUrl: text("pdf_url"),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("invoices_ext_uq").on(t.provider, t.externalId), index("invoices_org_idx").on(t.organizationId, t.issuedAt)]);

/** Counter rows: (org, metric, period). Incremented atomically with ON CONFLICT. */
export const usageRecords = pgTable("usage_records", {
  id: id(),
  organizationId: orgId(),
  metric: text("metric").notNull(), // api_requests | posts_published | ...
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  value: bigint("value", { mode: "number" }).notNull().default(0),
  thresholdNotified: integer("threshold_notified").notNull().default(0),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("usage_records_uq").on(t.organizationId, t.metric, t.periodStart)]);

// ───────────────────────── Sprint 3: content ops ─────────────────────────

export const contentTemplates = pgTable("content_templates", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("caption"), // caption | hashtags | first_comment
  body: text("body").notNull(),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("content_templates_ws_idx").on(t.workspaceId)]);

export const rssFeeds = pgTable("rss_feeds", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  boardId: uuid("board_id").references(() => ideaBoards.id, { onDelete: "set null" }),
  url: text("url").notNull(),
  title: text("title"),
  active: boolean("active").notNull().default(true),
  etag: text("etag"),
  lastModified: text("last_modified"),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("rss_feeds_ws_url_uq").on(t.workspaceId, t.url)]);

/** Bulk CSV (+ZIP) imports. Same file + same target in a workspace = same import (idempotent). */
export const bulkImports = pgTable("bulk_imports", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  filename: text("filename").notNull(),
  fileSha256: text("file_sha256").notNull(),
  target: text("target").notNull(), // draft | queue | scheduled
  status: text("status").notNull().default("validated"), // validated | committed | failed
  rows: jsonb("rows").$type<Record<string, unknown>[]>().notNull().default([]),
  summary: jsonb("summary").$type<Record<string, number>>().notNull().default({}),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: createdAt(),
  committedAt: timestamp("committed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("bulk_imports_uq").on(t.workspaceId, t.fileSha256, t.target)]);

// ───────────────────────── Sprint 5: links, integrations, ops ─────────────────────────

/** Own-domain short links (no third party). */
export const shortLinks = pgTable("short_links", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  code: text("code").notNull(),
  targetUrl: text("target_url").notNull(),
  postId: uuid("post_id"),
  clicks: integer("clicks").notNull().default(0),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: createdAt(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
}, (t) => [uniqueIndex("short_links_code_uq").on(t.code), index("short_links_ws_idx").on(t.workspaceId)]);

/** Privacy-friendly first-party events (no IP, no cookie): day bucket + coarse device + referrer host. */
export const linkEvents = pgTable("link_events", {
  id: id(),
  organizationId: orgId(),
  workspaceId: wsId(),
  kind: text("kind").notNull(), // page_view | block_click | grid_click | short_click
  startPageId: uuid("start_page_id"),
  blockId: uuid("block_id"),
  shortLinkId: uuid("short_link_id"),
  device: text("device"), // mobile | desktop | bot
  referrerHost: text("referrer_host"),
  day: text("day").notNull(), // YYYY-MM-DD (UTC)
  createdAt: createdAt(),
}, (t) => [index("link_events_ws_day_idx").on(t.workspaceId, t.day)]);

/** Third-party integration credentials per organization (encrypted). */
export const integrationCredentials = pgTable("integration_credentials", {
  id: id(),
  organizationId: orgId(),
  provider: text("provider").notNull(), // bitly | ...
  secretEnc: text("secret_enc").notNull(),
  keyVersion: text("key_version").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("integration_credentials_uq").on(t.organizationId, t.provider)]);

/** Liveness of background processes for the status page. */
export const systemHeartbeats = pgTable("system_heartbeats", {
  name: text("name").primaryKey(), // worker:<host>:<pid> | api
  kind: text("kind").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
});
