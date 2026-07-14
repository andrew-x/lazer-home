import { createUpdateSchema } from "drizzle-zod";
import { z } from "zod";
import { companies } from "@/lib/db/schema";
import { id } from "@/lib/id-schema";
import { optionalUrl } from "@/lib/url-schema";

/**
 * Company edit input. Built from the Drizzle update schema — the `companies`
 * table is the single source of truth for which columns exist — with the same
 * user-facing refinements as create (required trimmed name, shared optional-URL
 * validator, partner flag) plus an optional owner (a staff id) and the `id`
 * targeting the row. Lives in its own file so the edit form can import it for
 * the resolver (never export schemas from a "use server" file).
 */
export const updateCompanySchema = createUpdateSchema(companies)
  .pick({ name: true, websiteUrl: true, isPartner: true, ownerId: true })
  .extend({
    id,
    name: z.string().trim().min(1, "Name is required.").max(200),
    websiteUrl: optionalUrl,
    isPartner: z.boolean().default(false),
    // Optional owner — an existing staff id, or null to unassign.
    ownerId: id.nullable().default(null),
  });

export type UpdateCompanyInput = z.input<typeof updateCompanySchema>;
