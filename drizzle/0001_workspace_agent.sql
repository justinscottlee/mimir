CREATE TABLE "workspace_files" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"path" text NOT NULL,
	"type" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"seq" integer NOT NULL,
	"goal" text NOT NULL,
	"status" text NOT NULL,
	"model" text,
	"summary" text,
	"error" text,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "agent" jsonb;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_runs" ADD CONSTRAINT "workspace_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_files_workspace_id_idx" ON "workspace_files" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_files_ws_path_idx" ON "workspace_files" USING btree ("workspace_id","path");--> statement-breakpoint
CREATE INDEX "workspace_runs_workspace_id_idx" ON "workspace_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_runs_ws_seq_idx" ON "workspace_runs" USING btree ("workspace_id","seq");