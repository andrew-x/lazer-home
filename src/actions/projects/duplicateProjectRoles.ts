"use server";

import { inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { projectRoles } from "@/lib/db/schema";
import { assertRoleEditable } from "./assertRoleEditable";
import { duplicateProjectRolesSchema } from "./duplicateProjectRoles.schema";

/**
 * Bulk-duplicate tentative roles (the selection's "Duplicate"). Each copy is a
 * fresh tentative role for this opportunity **without** the assigned staff — an
 * open position ready to re-staff. Gated on `projects.edit`; `assertRoleEditable`
 * runs for every source id first, so a single non-editable role aborts the whole
 * batch in the transaction.
 */
export const duplicateProjectRoles = secureActionClient
  .metadata({
    action: "duplicate-project-roles",
    permission: { projects: ["edit"] },
  })
  .inputSchema(duplicateProjectRolesSchema)
  .action(async ({ parsedInput }) => {
    const { opportunityId, roleIds } = parsedInput;
    const ids = await db.transaction(async (tx) => {
      for (const roleId of roleIds) {
        await assertRoleEditable(tx, roleId, opportunityId);
      }
      const rows = await tx
        .select({
          projectId: projectRoles.projectId,
          lineOfBusiness: projectRoles.lineOfBusiness,
          description: projectRoles.description,
          roleType: projectRoles.roleType,
          startDate: projectRoles.startDate,
          endDate: projectRoles.endDate,
          hoursPerDay: projectRoles.hoursPerDay,
        })
        .from(projectRoles)
        .where(inArray(projectRoles.id, roleIds));

      const values = rows.map((row) => ({
        id: generateId("proj-role"),
        projectId: row.projectId,
        opportunityId,
        status: "tentative" as const,
        // Copy the shape, not the person — the copy is an open position.
        staffId: null,
        lineOfBusiness: row.lineOfBusiness,
        description: row.description,
        roleType: row.roleType,
        startDate: row.startDate,
        endDate: row.endDate,
        hoursPerDay: row.hoursPerDay,
      }));
      if (values.length) await tx.insert(projectRoles).values(values);
      return values.map((v) => v.id);
    });

    revalidatePath("/opportunities");
    revalidatePath("/projects");
    return { ids };
  });
