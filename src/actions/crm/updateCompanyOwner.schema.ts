import { createUpdateSchema } from "drizzle-zod";
import type { z } from "zod";
import { companies } from "@/lib/db/schema";
import { id, ownerId } from "@/lib/id-schema";

/**
 * Owner-only company update. A deliberately narrow counterpart to
 * `updateCompanySchema`: the inline owner field on the company page changes just
 * the owner, so it targets `companies.ownerId` alone rather than re-sending (and
 * re-validating) the whole record. `ownerId` is a staff id, or null to unassign.
 * Lives in its own file so the client component can import it (never export
 * schemas from a "use server" file).
 */
export const updateCompanyOwnerSchema = createUpdateSchema(companies)
  .pick({ ownerId: true })
  .extend({
    id,
    ownerId,
  });

export type UpdateCompanyOwnerInput = z.input<typeof updateCompanyOwnerSchema>;
