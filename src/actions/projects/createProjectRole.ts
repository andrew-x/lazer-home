"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { opportunities, projectRoles } from "@/lib/db/schema";
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

    const opportunityRows = await db
      .select({ projectId: opportunities.projectId })
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId))
      .limit(1);
    assertRowExists(opportunityRows, "opportunity");
    const [opportunity] = opportunityRows;
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
      lineOfBusiness: parsedInput.lineOfBusiness,
      staffId: parsedInput.staffId ?? null,
      description: parsedInput.description,
      roleType: parsedInput.roleType,
      startDate: parsedInput.startDate,
      endDate: parsedInput.endDate,
      hoursPerDay: parsedInput.hoursPerDay,
      // Snapshotted by `snapshotBillRate` when the form left it blank.
      billRate: parsedInput.billRate,
    });

    revalidatePath("/opportunities");
    revalidatePath("/projects");
    return { id: roleId };
  });
