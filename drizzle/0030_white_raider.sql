DROP INDEX "projects_opportunity_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "projects_opportunity_idx" ON "projects" USING btree ("opportunity_id") WHERE "opportunity_id" is not null;