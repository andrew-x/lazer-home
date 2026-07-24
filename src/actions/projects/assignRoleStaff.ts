"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { projectRoles } from "@/lib/db/schema";
import { assertRoleEditable } from "./assertRoleEditable";
import { assignRoleStaffSchema } from "./assignRoleStaff.schema";

/**
 * Inline "Assign staff" on a planner role — set who fills it (or clear it back
 * to an open position). Gated on `projects.edit`; `assertRoleEditable` enforces
 * the role is tentative and belongs to this opportunity.
 */
export const assignRoleStaff = secureActionClient
  .metadata({
    action: "assign-role-staff",
    permission: { projects: ["edit"] },
  })
  .inputSchema(assignRoleStaffSchema)
  .action(async ({ parsedInput }) => {
    await db.transaction(async (tx) => {
      await assertRoleEditable(
        tx,
        parsedInput.roleId,
        parsedInput.opportunityId,
      );
      await tx
        .update(projectRoles)
        .set({ staffId: parsedInput.staffId })
        .where(eq(projectRoles.id, parsedInput.roleId));
    });

    revalidatePath("/opportunities");
    revalidatePath("/projects");
    return { id: parsedInput.roleId };
  });
