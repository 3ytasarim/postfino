CREATE TABLE "oauth_client_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" NOT NULL,
	"instance" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" text NOT NULL,
	"key_version" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scopes" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "instance" text;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_client_apps_uq" ON "oauth_client_apps" USING btree ("platform","instance","redirect_uri");