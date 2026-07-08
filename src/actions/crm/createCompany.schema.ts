import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { companies } from "@/lib/db/schema";
import { optionalUrl } from "@/lib/url-schema";

/**
 * Company create input. Built from the Drizzle insert schema — the `companies`
 * table is the single source of truth for which columns exist — with the
 * user-facing fields refined: a required trimmed name, the shared optional-URL
 * validator, and a partner flag defaulting to false. `id`/timestamps are
 * DB-managed and omitted.
 */
export const createCompanySchema = createInsertSchema(companies)
  .pick({ name: true, websiteUrl: true, isPartner: true })
  .extend({
    name: z.string().trim().min(1, "Name is required.").max(200),
    websiteUrl: optionalUrl,
    isPartner: z.boolean().default(false),
  });

export type CreateCompanyInput = z.input<typeof createCompanySchema>;
