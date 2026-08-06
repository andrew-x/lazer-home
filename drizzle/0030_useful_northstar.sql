CREATE TABLE "drive_transcript_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"drive_folder_id" text NOT NULL,
	"folder_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"drive_file_id" text NOT NULL,
	"file_name" text NOT NULL,
	"file_created_at" timestamp,
	"dismissed" boolean DEFAULT false NOT NULL,
	"opportunity_id" text,
	"project_id" text,
	"copied_file_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_assignments_shape" CHECK (("transcript_assignments"."dismissed"
             and num_nonnulls("transcript_assignments"."opportunity_id", "transcript_assignments"."project_id") = 0
             and "transcript_assignments"."copied_file_id" is null)
          or (not "transcript_assignments"."dismissed"
             and num_nonnulls("transcript_assignments"."opportunity_id", "transcript_assignments"."project_id") = 1
             and "transcript_assignments"."copied_file_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "drive_transcript_folders" ADD CONSTRAINT "drive_transcript_folders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_assignments" ADD CONSTRAINT "transcript_assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_assignments" ADD CONSTRAINT "transcript_assignments_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_assignments" ADD CONSTRAINT "transcript_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_transcript_folders_user_folder_idx" ON "drive_transcript_folders" USING btree ("user_id","drive_folder_id");--> statement-breakpoint
CREATE INDEX "drive_transcript_folders_user_idx" ON "drive_transcript_folders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_assignments_project_idx" ON "transcript_assignments" USING btree ("user_id","drive_file_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_assignments_opportunity_idx" ON "transcript_assignments" USING btree ("user_id","drive_file_id","opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_assignments_dismissed_idx" ON "transcript_assignments" USING btree ("user_id","drive_file_id") WHERE "transcript_assignments"."dismissed";--> statement-breakpoint
CREATE INDEX "transcript_assignments_user_file_idx" ON "transcript_assignments" USING btree ("user_id","drive_file_id");