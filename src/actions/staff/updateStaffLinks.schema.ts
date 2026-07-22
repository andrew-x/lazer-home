import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import { optionalUrl } from "@/lib/schemas/url-schema";

/**
 * Staff links edit input — a pure, client-importable module (no `db`/drizzle) so
 * the edit form's resolver and the server action share one schema. Each URL is
 * refined by the shared optional-URL validator; `staffId` targets the row.
 */
export const updateStaffLinksSchema = z.object({
  staffId: id,
  linkedinUrl: optionalUrl,
  githubUrl: optionalUrl,
  portfolioUrl: optionalUrl,
});

export type UpdateStaffLinksInput = z.input<typeof updateStaffLinksSchema>;
