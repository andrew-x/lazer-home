import { z } from "zod";
import { id, idList } from "@/lib/schemas/id-schema";
import { projectName } from "./updateProject.schema";

/**
 * Field-scoped edit of a single project attribute from the detail page's inline
 * fields (name, company, delivery managers).
 *
 * A discriminated union on `field`: each variant carries only the slice that field
 * owns, so an inline edit writes just what changed instead of re-sending the whole
 * record (which last-write-wins clobbers a concurrent edit, and would needlessly
 * rewrite the delivery-manager junction on a name change). Mirrors
 * `updateCompanyFieldSchema`. A pure, client-importable module (no `db`/drizzle)
 * so the inline field components and the action share one schema.
 *
 * A project's status and lines of business are derived from its roles, so neither is
 * a field here. Moving a project to another **company** is allowed but constrained:
 * the action refuses when a linked opportunity would be left pointing at a project
 * belonging to a different company (see `updateProjectField`).
 */
export const updateProjectFieldSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("name"), projectId: id, name: projectName }),
  z.object({ field: z.literal("company"), projectId: id, companyId: id }),
  z.object({
    field: z.literal("deliveryManagers"),
    projectId: id,
    deliveryManagerIds: idList,
  }),
]);

export type UpdateProjectFieldInput = z.input<typeof updateProjectFieldSchema>;
