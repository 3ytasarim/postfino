ALTER TABLE "comment_threads" ADD COLUMN "published_post_id" uuid;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD COLUMN "post_permalink" text;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD COLUMN "post_caption" text;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "authored_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "error" text;