import { z } from "zod";
import { roleSchema } from "@/lib/auth/permissions";
import { id } from "@/lib/schemas/id-schema";

/**
 * One user's desired RBAC state. `role` validates against the permission matrix
 * (`roleSchema`) so an arbitrary string can never reach `user.role`; it is
 * nullable because the column is (legacy users may have no role) — a ban-only
 * edit on such a user keeps `role` null rather than silently assigning one.
 * Shared with the client component for the form/payload type — kept out of the
 * `'use server'` file per the server-actions rule.
 */
export const userChangeSchema = z.object({
  userId: id,
  role: roleSchema.nullable(),
  banned: z.boolean(),
});

export type UserChange = z.infer<typeof userChangeSchema>;

export const updateUsersSchema = z.object({
  changes: z.array(userChangeSchema).min(1),
});
