ALTER TABLE "opportunities" ADD COLUMN "scoping_slack_channel_id" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "scoping_slack_channel_name" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "slack_channel_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "slack_channel_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_scoping_slack_channel_idx" ON "opportunities" USING btree ("scoping_slack_channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slack_channel_idx" ON "projects" USING btree ("slack_channel_id");--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_scoping_slack_channel_shape" CHECK (("opportunities"."scoping_slack_channel_id" is null and "opportunities"."scoping_slack_channel_name" is null)
       or ("opportunities"."scoping_slack_channel_id" is not null and "opportunities"."scoping_slack_channel_name" is not null));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_slack_channel_shape" CHECK (("projects"."slack_channel_id" is null and "projects"."slack_channel_name" is null)
       or ("projects"."slack_channel_id" is not null and "projects"."slack_channel_name" is not null));