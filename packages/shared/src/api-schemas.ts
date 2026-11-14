import { z } from "zod";
import { API_SCOPES, POST_TYPES, PUBLISH_MODES, WEBHOOK_EVENTS, COVER_MODES } from "./enums";

// Public API v1 request bodies. snake_case on the wire.

const isoWithOffset = z
  .string()
  .refine((v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v), {
    message: "must be ISO-8601 with explicit offset, e.g. 2026-11-12T10:00:00+01:00",
  });

export const targetOverrideSchema = z.object({
  account_id: z.string().uuid(),
  caption: z.string().max(5000).optional(),
  publish_mode: z.enum(PUBLISH_MODES).optional(),
  share_to_feed: z.boolean().optional(),
  first_comment: z.string().max(2200).optional(),
  /** YouTube video title / Pinterest pin title. */
  title: z.string().max(200).optional(),
  /** YouTube: public|unlisted|private. TikTok: PUBLIC_TO_EVERYONE|MUTUAL_FOLLOW_FRIENDS|FOLLOWER_OF_CREATOR|SELF_ONLY (required). */
  privacy: z.string().max(40).optional(),
  /** Destination link (Pinterest, Google Business call-to-action). */
  link: z.string().url().max(2000).optional(),
});

export const createPostSchema = z
  .object({
    workspace_id: z.string().uuid(),
    account_ids: z.array(z.string().uuid()).min(1).max(50),
    type: z.enum(POST_TYPES),
    caption: z.string().max(5000).default(""),
    media_asset_ids: z.array(z.string().uuid()).max(20).default([]),
    video_asset_id: z.string().uuid().optional(),
    cover_asset_id: z.string().uuid().optional(),
    cover_mode: z.enum(COVER_MODES).optional(),
    thumb_offset_ms: z.number().int().min(0).optional(),
    scheduled_at: isoWithOffset.optional(),
    timezone: z.string().optional(),
    status: z.enum(["draft", "scheduled"]).default("draft"),
    /** Use the next free posting slot of each account instead of scheduled_at. */
    queue: z.boolean().optional(),
    publish_mode: z.enum(PUBLISH_MODES).default("automatic"),
    targets: z.array(targetOverrideSchema).optional(),
    tags: z.array(z.string().max(60)).max(30).optional(),
    external_ref: z.string().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === "scheduled" && !v.scheduled_at && !v.queue)
      ctx.addIssue({ code: "custom", path: ["scheduled_at"], message: "required when status=scheduled" });
    if (v.cover_asset_id && v.type !== "reel")
      ctx.addIssue({ code: "custom", path: ["cover_asset_id"], message: "only allowed for type=reel" });
    if (v.type === "reel" && !v.video_asset_id)
      ctx.addIssue({ code: "custom", path: ["video_asset_id"], message: "required for type=reel" });
  });
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const updatePostSchema = z.object({
  caption: z.string().max(5000).optional(),
  scheduled_at: isoWithOffset.nullable().optional(),
  cover_asset_id: z.string().uuid().nullable().optional(),
  video_asset_id: z.string().uuid().optional(),
  media_asset_ids: z.array(z.string().uuid()).max(20).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
});
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

export const mediaUploadSchema = z.object({
  workspace_id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mime_type: z.string().min(3).max(100),
  size_bytes: z.number().int().positive(),
  purpose: z.enum(["video", "image", "cover", "document"]).default("image"),
});

export const createWebhookSchema = z.object({
  url: z.string().url().refine((u) => u.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u), {
    message: "must be https (http only for localhost)",
  }),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  workspace_id: z.string().uuid().optional(),
  description: z.string().max(200).optional(),
});

export const createApiKeySchema = z.object({
  name: z.string().min(2).max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
  workspace_ids: z.array(z.string().uuid()).min(1),
  environment: z.enum(["live", "test"]).default("live"),
  expires_at: z.string().datetime({ offset: true }).optional(),
});
