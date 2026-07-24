import { createUpdateSchema } from "drizzle-zod";
import { z } from "zod";
import { contacts } from "@/lib/db/schema";
import { id } from "@/lib/schemas/id-schema";

/**
 * Location-only contact update. A deliberately narrow counterpart to
 * `updateContactSchema`: the inline location field on the contact page changes
 * just the location, so it targets `contacts.location` alone rather than
 * re-sending the whole record. `location` is a `"City, CC"` label picked from the
 * world-cities list, or null to clear it. Lives in its own file so the client
 * component can import it (never export schemas from a "use server" file).
 */
export const updateContactLocationSchema = createUpdateSchema(contacts)
  .pick({ location: true })
  .extend({
    id,
    location: z.string().min(1).nullable(),
  });

export type UpdateContactLocationInput = z.input<
  typeof updateContactLocationSchema
>;
