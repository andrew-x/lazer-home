import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { companies } from "@/lib/db/schema";
import { optionalUrl } from "@/lib/url-schema";

/**
 * The user-facing company field refinements shared by create and update: a
 * required trimmed name, the shared optional-URL validator, and a partner flag
 * defaulting to false. Spread into both schemas' `.extend(...)` so the two can't
 * drift (mirrors `opportunityBaseFields`); update layers `id` and `ownerId` on
 * top.
 */
export const companyFields = {
  name: z.string().trim().min(1, "Name is required.").max(200),
  websiteUrl: optionalUrl,
  isPartner: z.boolean().default(false),
};

/**
 * Company create input. Built from the Drizzle insert schema — the `companies`
 * table is the single source of truth for which columns exist — with the shared
 * `companyFields` refinements applied. `id`/timestamps are DB-managed and
 * omitted.
 */
export const createCompanySchema = createInsertSchema(companies)
  .pick({ name: true, websiteUrl: true, isPartner: true })
  .extend(companyFields);

export type CreateCompanyInput = z.input<typeof createCompanySchema>;
