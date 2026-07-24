"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { projectRoles } from "@/lib/db/schema";
import { addWeeks } from "@/lib/timesheets/timesheet-week";
import { assertRoleEditable } from "./assertRoleEditable";
import { bumpProjectRolesSchema } from "./bumpProjectRoles.schema";

/**
 * Bulk-shift tentative roles by whole weeks (the selection's "Bump timelines").
 * Both start and end move by `weeks`, preserving each role's duration. Gated on
 * `projects.edit`; `assertRoleEditable` runs for every id first, so a single
 * non-editable role aborts the whole batch in the transaction.
 */
export const bumpProjectRoles = secureActionClient
  .metadata({
    action: "bump-project-roles",
    permission: { projects: ["edit"] },
  })
  .inputSchema(bumpProjectRolesSchema)
  .action(async ({ parsedInput }) => {
    const { opportunityId, roleIds, weeks } = parsedInput;
    await db.transaction(async (tx) => {
      for (const roleId of roleIds) {
        await assertRoleEditable(tx, roleId, opportunityId);
      }
      const rows = await tx
        .select({
          id: projectRoles.id,
          startDate: projectRoles.startDate,
          endDate: projectRoles.endDate,
        })
        .from(projectRoles)
        .where(inArray(projectRoles.id, roleIds));
      for (const row of rows) {
        await tx
          .update(projectRoles)
          .set({
            startDate: addWeeks(row.startDate, weeks),
            endDate: addWeeks(row.endDate, weeks),
          })
          .where(eq(projectRoles.id, row.id));
      }
    });

    revalidatePath("/opportunities");
    revalidatePath("/projects");
    return { count: roleIds.length };
  });
