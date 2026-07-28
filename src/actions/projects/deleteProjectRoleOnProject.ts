"use server";

import { eq } from "drizzle-orm";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { projectRoles } from "@/lib/db/schema";
import { assertProjectRoleEditable } from "./assertProjectRoleEditable";
import { deleteProjectRoleOnProjectSchema } from "./deleteProjectRoleOnProject.schema";
import { revalidateProject } from "./revalidate";

/**
 * Delete a role from the project detail page — the delivery-side counterpart of
 * `deleteProjectRole`. Gated on `projects.edit`; `assertProjectRoleEditable`
 * enforces only that the role belongs to this project, so a confirmed role can be
 * removed here (the callers warn first).
 *
 * Nothing references `project_roles`, so this can neither fail on an inbound
 * foreign key nor orphan a child row. Logged time hangs off the *project*
 * (`timeEntries.projectId`), not the role, so deleting a role never touches
 * timesheets — it can, though, leave a project with logged hours and no staffing
 * line, and removing the last role shifts the project's derived status.
 */
export const deleteProjectRoleOnProject = secureActionClient
  .metadata({
    action: "delete-project-role-on-project",
    permission: { projects: ["edit"] },
  })
  .inputSchema(deleteProjectRoleOnProjectSchema)
  .action(async ({ parsedInput }) => {
    await db.transaction(async (tx) => {
      await assertProjectRoleEditable(
        tx,
        parsedInput.id,
        parsedInput.projectId,
      );
      await tx.delete(projectRoles).where(eq(projectRoles.id, parsedInput.id));
    });

    revalidateProject(parsedInput.projectId);
    return { id: parsedInput.id };
  });
