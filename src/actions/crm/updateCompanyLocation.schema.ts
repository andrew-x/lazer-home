import { createUpdateSchema } from "drizzle-zod";
import { z } from "zod";
import { companies } from "@/lib/db/schema";
import { id } from "@/lib/schemas/id-schema";

/**
 * Location-only company update. A deliberately narrow counterpart to
 * `updateCompanySchema`: the inline location field on the company page changes
 * just the location, so it targets `companies.location` alone rather than
 * re-sending the whole record. `location` is a `"City, CC"` label picked from the
 * world-cities list, or null to clear it. Lives in its own file so the client
 * component can import it (never export schemas from a "use server" file).
 */
export const updateCompanyLocationSchema = createUpdateSchema(companies)
  .pick({ location: true })
  .extend({
    id,
    location: z.string().min(1).nullable(),
  });

export type UpdateCompanyLocationInput = z.input<
  typeof updateCompanyLocationSchema
>;
