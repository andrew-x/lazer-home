import { sql } from "drizzle-orm";
import type { SeedDb } from "./client";

/**
 * Every table the seed populates, in an order that reads child → parent. A single
 * `TRUNCATE ... CASCADE` clears them all regardless of order (CASCADE follows the
 * FKs, including the `restrict` ones the seed otherwise has to respect on insert),
 * and `RESTART IDENTITY` resets any sequences. Listed explicitly rather than
 * globbed so wiping is deliberate and this file is the one place to reconcile when
 * a table is added to the schema.
 */
const SEEDABLE_TABLES = [
  // tasks (reference companies/contacts/opportunities)
  "tasks",
  // performance + survey
  "compensation_plan_item",
  "compensation_plan",
  "feedback",
  "performance_review_note",
  "staff_rating",
  "staff_self_evaluation",
  "responses",
  // timesheets
  "time_entries",
  "timesheets",
  // projects
  "project_delivery_notes",
  "project_roles",
  "project_delivery_managers",
  "projects",
  // opportunities
  "opportunity_entries",
  "opportunity_source_staff",
  "opportunity_source_contacts",
  "opportunity_owners",
  "opportunity_contacts",
  "opportunities",
  // crm
  "contact_entries",
  "company_entries",
  "contact_relationships",
  "company_contact_relationships",
  "contacts",
  "companies",
  // staff
  "staff_pto",
  "staff_employment",
  "staff",
  // auth
  "account",
  "session",
  "verification",
  "user",
] as const;

/** Truncate every seedable table so a reseed starts from a clean, known state. */
export async function wipe(db: SeedDb): Promise<void> {
  const list = SEEDABLE_TABLES.map((t) => `"${t}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${list} restart identity cascade`));
}
