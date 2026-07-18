"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { projectRoles } from "@/lib/db/schema";
import { assertRoleEditable } from "./assertRoleEditable";
import { deleteProjectRoleSchema } from "./deleteProjectRole.schema";

/**
 * Delete a tentative role from an opportunity's planner. Gated on
 * `projects.edit`; `assertRoleEditable` enforces the role is tentative and
 * belongs to this opportunity (confirmed / other-opportunity roles can't be
 * deleted here).
 */
export const deleteProjectRole = secureActionClient
  .metadata({
    action: "delete-project-role",
    permission: { projects: ["edit"] },
  })
  .inputSchema(deleteProjectRoleSchema)
  .action(async ({ parsedInput }) => {
    await db.transaction(async (tx) => {
      await assertRoleEditable(tx, parsedInput.id, parsedInput.opportunityId);
      await tx.delete(projectRoles).where(eq(projectRoles.id, parsedInput.id));
    });

    revalidatePath("/opportunities");
    revalidatePath("/projects");
    return { id: parsedInput.id };
  });
