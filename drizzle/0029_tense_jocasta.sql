ALTER TABLE "opportunities" ADD COLUMN "sales_drive_folder_id" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "sales_drive_folder_name" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "drive_folder_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "drive_folder_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_sales_drive_folder_idx" ON "opportunities" USING btree ("sales_drive_folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_drive_folder_idx" ON "projects" USING btree ("drive_folder_id");--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_sales_drive_folder_shape" CHECK (("opportunities"."sales_drive_folder_id" is null and "opportunities"."sales_drive_folder_name" is null)
       or ("opportunities"."sales_drive_folder_id" is not null and "opportunities"."sales_drive_folder_name" is not null));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_drive_folder_shape" CHECK (("projects"."drive_folder_id" is null and "projects"."drive_folder_name" is null)
       or ("projects"."drive_folder_id" is not null and "projects"."drive_folder_name" is not null));