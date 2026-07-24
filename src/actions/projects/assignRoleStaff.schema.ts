import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";

/**
 * Inline staff assignment on a planner role: set (or clear) who fills it.
 * `opportunityId` is the planner context — the role must be tentative and tagged
 * with it (enforced by `assertRoleEditable`). A pure, client-importable module.
 */
export const assignRoleStaffSchema = z.object({
  roleId: id,
  opportunityId: id,
  // The staff id to assign, or null to clear back to an open position.
  staffId: id.nullable(),
});

export type AssignRoleStaffInput = z.input<typeof assignRoleStaffSchema>;
