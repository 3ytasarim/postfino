// Domain enums shared by db, core, api and web. Values are persisted — never rename, only append.

export const ROLES = [
  "SUPER_ADMIN",
  "AGENCY_OWNER",
  "AGENCY_ADMIN",
  "MANAGER",
  "EDITOR",
  "APPROVER",
  "CLIENT_REVIEWER",
  "VIEWER",
] as const;
export type Role = (typeof ROLES)[number];

export const POST_STATUSES = [
  "IDEA",
  "DRAFT",
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
  "APPROVED",
  "SCHEDULED",
  "PREPARING_MEDIA",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "NOTIFICATION_SENT",
  "CANCELLED",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const PLATFORMS = [
  "instagram_business",
  "instagram_personal",
  "facebook_page",
  "facebook_group",
  "linkedin_page",
  "linkedin_profile",
  "tiktok",
  "youtube",
  "x",
  "threads",
  "pinterest",
  "bluesky",
  "mastodon",
  "google_business",
  "substack",
  "start_page",
  "sandbox",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const POST_TYPES = [
  "text",
  "image",
  "video",
  "carousel",
  "story",
  "reel",
  "short",
  "document",
  "thread",
] as const;
export type PostType = (typeof POST_TYPES)[number];

export const PUBLISH_MODES = ["automatic", "notification"] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];

export const CAPABILITY_STATES = [
  "supported",
  "requires_manual_notification",
  "requires_app_review",
  "unsupported",
  "unverified",
] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export const PLAN_CODES = ["starter", "pro", "agency", "enterprise"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const API_SCOPES = [
  "workspaces:read",
  "accounts:read",
  "accounts:connect",
  "media:write",
  "posts:read",
  "posts:write",
  "posts:publish",
  "calendar:read",
  "analytics:read",
  "webhooks:manage",
  "usage:read",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const WEBHOOK_EVENTS = [
  "account.connected",
  "account.disconnected",
  "post.created",
  "post.approved",
  "post.scheduled",
  "post.published",
  "post.failed",
  "media.failed",
  "quota.threshold_reached",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const CHANNEL_STATUSES = ["active", "needs_reauth", "revoked", "disconnected"] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export const COVER_MODES = ["video_frame", "independent_image"] as const;
export type CoverMode = (typeof COVER_MODES)[number];

export const LOCALES = ["de", "en", "tr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "de";
