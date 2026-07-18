"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { projectRoles } from "@/lib/db/schema";
import { assertRoleEditable } from "./assertRoleEditable";
import { updateProjectRoleSchema } from "./updateProjectRole.schema";

/**
 * Edit a tentative role from an opportunity's planner. Gated on `projects.edit`;
 * `assertRoleEditable` enforces that the role is tentative and belongs to this
 * opportunity (confirmed roles and other opportunities' roles are read-only
 * here). Only the editable fields change — the role's status and opportunity tag
 * are untouched.
 */
export const updateProjectRole = secureActionClient
  .metadata({
    action: "update-project-role",
    permission: { projects: ["edit"] },
  })
  .inputSchema(updateProjectRoleSchema)
  .action(async ({ parsedInput }) => {
    await db.transaction(async (tx) => {
      await assertRoleEditable(tx, parsedInput.id, parsedInput.opportunityId);

      await tx
        .update(projectRoles)
        .set({
          staffId: parsedInput.staffId ?? null,
          name: parsedInput.name,
          roleType: parsedInput.roleType,
          startDate: parsedInput.startDate,
          endDate: parsedInput.endDate,
          hoursPerDay: parsedInput.hoursPerDay,
        })
        .where(eq(projectRoles.id, parsedInput.id));
    });

    revalidatePath("/opportunities");
    revalidatePath("/projects");
    return { id: parsedInput.id };
  });
