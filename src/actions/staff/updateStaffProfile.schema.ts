import { createUpdateSchema } from "drizzle-zod";
import { z } from "zod";
import { staffProfile } from "@/lib/db/schema";

/**
 * Input schema lives in its OWN file (not the "use server" action file) so it
 * can be imported by client components for the form resolver.
 *
 * Default approach: derive from drizzle-zod. `createUpdateSchema` makes columns
 * optional; we pick the editable fields and require `id` to target the row.
 */
export const updateStaffProfileSchema = createUpdateSchema(staffProfile)
  .pick({ title: true, bio: true })
  .extend({ id: z.string().min(1) });

export type UpdateStaffProfileInput = z.infer<typeof updateStaffProfileSchema>;
