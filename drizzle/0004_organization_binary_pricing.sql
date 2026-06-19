ALTER TABLE "conversations" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "tag_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "tool_output" jsonb;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "folders" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "pricing" jsonb;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD COLUMN "encoding" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "tag_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;