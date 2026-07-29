"use server";

import { eq } from "drizzle-orm";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { projects } from "@/lib/db/schema";
import { projectBudgetColumns } from "./projectBudgetWrite";
import { revalidateProject } from "./revalidate";
import { updateProjectBudgetSchema } from "./updateProjectBudget.schema";

/**
 * Re-price a project: set its billing model, and the total fee if it has one.
 * Gated on `projects.edit` — the same capability that staffs a project. (Seeing the
 * resulting *margin* is a separate read capability, `projects.viewMargin`, because
 * that number is derived from individual compensation.)
 *
 * A dedicated action rather than another field on `updateProject`, which owns the
 * name + delivery managers and re-sends everything it holds: folding the budget in
 * would make renaming a project also re-submit its price, exactly the
 * last-write-wins clobbering `updateProjectField` exists to avoid.
 *
 * One statement, no transaction: switching to time and materials clears the fee in
 * the same `set` (see `projectBudgetColumns`), and the `projects_budget_shape` check
 * constraint is the backstop if it ever didn't.
 */
export const updateProjectBudget = secureActionClient
  .metadata({
    action: "update-project-budget",
    permission: { projects: ["edit"] },
  })
  .inputSchema(updateProjectBudgetSchema)
  .action(async ({ parsedInput: { projectId, budget } }) => {
    const [updated] = await db
      .update(projects)
      .set(projectBudgetColumns(budget))
      .where(eq(projects.id, projectId))
      .returning({ id: projects.id });

    if (!updated) {
      throw new UserSafeActionError("That project no longer exists.");
    }

    revalidateProject(projectId);
    return { id: updated.id };
  });
