CREATE TABLE "generated_images" (
	"id" text PRIMARY KEY NOT NULL,
	"studio_id" text NOT NULL,
	"seq" integer NOT NULL,
	"src" text NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_studios" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"model" text,
	"params" jsonb,
	"folder_id" text,
	"tag_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "default_image_model" text;--> statement-breakpoint
ALTER TABLE "generated_images" ADD CONSTRAINT "generated_images_studio_id_image_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."image_studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_studios" ADD CONSTRAINT "image_studios_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generated_images_studio_id_idx" ON "generated_images" USING btree ("studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generated_images_studio_seq_idx" ON "generated_images" USING btree ("studio_id","seq");--> statement-breakpoint
CREATE INDEX "image_studios_user_id_idx" ON "image_studios" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "image_studios_user_updated_idx" ON "image_studios" USING btree ("user_id","updated_at");