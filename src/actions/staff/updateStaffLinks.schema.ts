import { createUpdateSchema } from "drizzle-zod";
import type { z } from "zod";
import { staff } from "@/lib/db/schema";
import { id } from "@/lib/id-schema";
import { optionalUrl } from "@/lib/url-schema";

/**
 * Staff links edit input. Built from the Drizzle update schema — the `staff`
 * table is the single source of truth for which columns exist — with each URL
 * refined by the shared optional-URL validator; `staffId` targets the row. Lives
 * in its own file so the edit form can import it for the resolver (never export
 * schemas from a "use server" file).
 */
export const updateStaffLinksSchema = createUpdateSchema(staff)
  .pick({ linkedinUrl: true, githubUrl: true, portfolioUrl: true })
  .extend({
    staffId: id,
    linkedinUrl: optionalUrl,
    githubUrl: optionalUrl,
    portfolioUrl: optionalUrl,
  });

export type UpdateStaffLinksInput = z.input<typeof updateStaffLinksSchema>;
