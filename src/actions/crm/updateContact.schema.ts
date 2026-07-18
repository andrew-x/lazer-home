import { createUpdateSchema } from "drizzle-zod";
import type { z } from "zod";
import { contacts } from "@/lib/db/schema";
import { id } from "@/lib/id-schema";
import { contactFields } from "./createContact.schema";

/**
 * Contact edit input. Built from the Drizzle update schema — the `contacts`
 * table is the single source of truth for which columns exist — with the same
 * shared `contactFields` refinements as create (so the two can't drift) plus an
 * optional owner (a staff id) and the `id` targeting the row. Lives in its own
 * file so the edit form can import it for the resolver (never export schemas from
 * a "use server" file).
 */
export const updateContactSchema = createUpdateSchema(contacts)
  .pick({
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    companyId: true,
    role: true,
    linkedinUrl: true,
    managerId: true,
    ownerId: true,
  })
  .extend({
    ...contactFields,
    id,
    // Optional owner — an existing staff id, or null to unassign.
    ownerId: id.nullable().default(null),
  });

export type UpdateContactInput = z.input<typeof updateContactSchema>;
