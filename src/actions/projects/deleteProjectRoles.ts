"use server";

import { inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { projectRoles } from "@/lib/db/schema";
import { assertRoleEditable } from "./assertRoleEditable";
import { deleteProjectRolesSchema } from "./deleteProjectRoles.schema";

/**
 * Bulk-delete tentative roles from an opportunity's planner (the selection's
 * "Delete"). Gated on `projects.edit`; `assertRoleEditable` runs for every id
 * first, so a single non-editable (confirmed / other-opportunity) role aborts
 * the whole batch in the transaction.
 */
export const deleteProjectRoles = secureActionClient
  .metadata({
    action: "delete-project-roles",
    permission: { projects: ["edit"] },
  })
  .inputSchema(deleteProjectRolesSchema)
  .action(async ({ parsedInput }) => {
    const { opportunityId, roleIds } = parsedInput;
    await db.transaction(async (tx) => {
      for (const roleId of roleIds) {
        await assertRoleEditable(tx, roleId, opportunityId);
      }
      await tx.delete(projectRoles).where(inArray(projectRoles.id, roleIds));
    });

    revalidatePath("/opportunities");
    revalidatePath("/projects");
    return { count: roleIds.length };
  });
