import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";

/**
 * Delete a role from the project detail page. `projectId` is the current page's
 * project — the role must belong to it (enforced by `assertProjectRoleEditable`).
 * A pure, client-importable module (no `db`/drizzle).
 */
export const deleteProjectRoleOnProjectSchema = z.object({
  id,
  projectId: id,
});

export type DeleteProjectRoleOnProjectInput = z.input<
  typeof deleteProjectRoleOnProjectSchema
>;
