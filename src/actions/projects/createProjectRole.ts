"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { opportunities, projectRoles } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { createProjectRoleSchema } from "./createProjectRole.schema";

/**
 * Add a tentative staffing role to the project that delivers an opportunity —
 * the planner's "add a new row" (a fresh role or open position). Gated on
 * `projects.edit`. The target project is derived from the opportunity's
 * `projectId` (so a role can't be planted on an unrelated project); the role is
 * tagged with the opportunity and created `tentative`.
 */
export const createProjectRole = secureActionClient
  .metadata({
    action: "create-project-role",
    permission: { projects: ["edit"] },
  })
  .inputSchema(createProjectRoleSchema)
  .action(async ({ parsedInput }) => {
    const { opportunityId } = parsedInput;

    const [opportunity] = await db
      .select({ projectId: opportunities.projectId })
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId))
      .limit(1);
    if (!opportunity) {
      throw new UserSafeActionError("That opportunity no longer exists.");
    }
    if (!opportunity.projectId) {
      throw new UserSafeActionError(
        "Associate or create a project for this opportunity first.",
      );
    }

    const roleId = generateId("proj-role");
    await db.insert(projectRoles).values({
      id: roleId,
      projectId: opportunity.projectId,
      opportunityId,
      status: "tentative",
      staffId: parsedInput.staffId ?? null,
      name: parsedInput.name,
      roleType: parsedInput.roleType,
      startDate: parsedInput.startDate,
      endDate: parsedInput.endDate,
      hoursPerDay: parsedInput.hoursPerDay,
    });

    revalidatePath("/opportunities");
    revalidatePath("/projects");
    return { id: roleId };
  });
