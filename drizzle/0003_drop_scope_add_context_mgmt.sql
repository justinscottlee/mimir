ALTER TABLE "settings" ADD COLUMN "context_management" jsonb;--> statement-breakpoint
ALTER TABLE "system_prompts" DROP COLUMN "scope_conversations";--> statement-breakpoint
ALTER TABLE "system_prompts" DROP COLUMN "scope_workspaces";