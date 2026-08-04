"use server";

import { eq } from "drizzle-orm";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { projectRoles } from "@/lib/db/schema";
import { assertProjectRoleEditable } from "./assertProjectRoleEditable";
import { revalidateProject } from "./revalidate";
import { updateProjectRoleOnProjectSchema } from "./updateProjectRoleOnProject.schema";

/**
 * Edit a role from the project detail page — the delivery-side counterpart of
 * `updateProjectRole`. Gated on `projects.edit`; `assertProjectRoleEditable`
 * enforces that the role belongs to this project (and, deliberately, nothing more —
 * a confirmed role on a live engagement is editable here). Only the editable fields
 * change: the role's status and opportunity tag are untouched, so a role that came
 * from a won deal keeps its provenance.
 */
export const updateProjectRoleOnProject = secureActionClient
  .metadata({
    action: "update-project-role-on-project",
    permission: { projects: ["edit"] },
  })
  .inputSchema(updateProjectRoleOnProjectSchema)
  .action(async ({ parsedInput }) => {
    await db.transaction(async (tx) => {
      await assertProjectRoleEditable(
        tx,
        parsedInput.id,
        parsedInput.projectId,
      );

      await tx
        .update(projectRoles)
        .set({
          lineOfBusiness: parsedInput.lineOfBusiness,
          staffId: parsedInput.staffId ?? null,
          description: parsedInput.description,
          roleType: parsedInput.roleType,
          startDate: parsedInput.startDate,
          endDate: parsedInput.endDate,
          hoursPerDay: parsedInput.hoursPerDay,
          // A blank rate field means "re-snapshot from today's card", which
          // `snapshotBillRate` has already resolved — so this is how a role stuck on a
          // superseded price gets reset.
          billRate: parsedInput.billRate,
        })
        .where(eq(projectRoles.id, parsedInput.id));
    });

    revalidateProject(parsedInput.projectId);
    return { id: parsedInput.id };
  });
