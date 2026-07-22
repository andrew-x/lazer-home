import { z } from "zod";
import { id, ownerId } from "@/lib/schemas/id-schema";
import { companyFields } from "./createCompany.schema";

/**
 * Company edit input — a pure, client-importable module (no `db`/drizzle) so the
 * edit form's resolver and the server action share one schema. Reuses the same
 * shared `companyFields` refinements as create (so the two can't drift) plus an
 * optional owner and the `id` targeting the row.
 */
export const updateCompanySchema = z.object({
  ...companyFields,
  id,
  ownerId,
});

export type UpdateCompanyInput = z.input<typeof updateCompanySchema>;
