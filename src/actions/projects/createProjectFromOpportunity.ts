"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { opportunities, projects } from "@/lib/db/schema";
import { createProjectFromOpportunitySchema } from "./createProjectFromOpportunity.schema";
import { projectBudgetColumns } from "./projectBudgetWrite";

/**
 * Create a project straight from an opportunity — the planner's "Create project",
 * whose only form is the budget. The project inherits the opportunity's `name` and
 * `companyId`; it has no line of business or status of its own (both are derived
 * from its roles, which are added afterward in the planner). Gated on
 * `projects.edit`.
 */
export const createProjectFromOpportunity = secureActionClient
  .metadata({
    action: "create-project-from-opportunity",
    permission: { projects: ["edit"] },
  })
  .inputSchema(createProjectFromOpportunitySchema)
  .action(async ({ parsedInput: { opportunityId, budget } }) => {
    const opportunityRows = await db
      .select({
        name: opportunities.name,
        companyId: opportunities.companyId,
        projectId: opportunities.projectId,
      })
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId))
      .limit(1);

    assertRowExists(opportunityRows, "opportunity");
    const [opportunity] = opportunityRows;
    if (opportunity.projectId) {
      throw new UserSafeActionError("This opportunity already has a project.");
    }

    const projectId = generateId("proj");

    await db.transaction(async (tx) => {
      await tx.insert(projects).values({
        id: projectId,
        // Inherit the opportunity's name and company.
        name: opportunity.name,
        companyId: opportunity.companyId,
        ...projectBudgetColumns(budget),
      });

      // Link the opportunity to this new project. The `is null` predicate is the
      // atomic "one project per opportunity" guard (see `createProject`): a
      // concurrent link leaves 0 rows updated here, so this throws and the whole
      // insert rolls back — no orphaned project.
      const [linked] = await tx
        .update(opportunities)
        .set({ projectId })
        .where(
          and(
            eq(opportunities.id, opportunityId),
            isNull(opportunities.projectId),
          ),
        )
        .returning({ id: opportunities.id });
      if (!linked) {
        throw new UserSafeActionError(
          "This opportunity already has a project.",
        );
      }
    });

    revalidatePath("/projects");
    revalidatePath("/opportunities");
    return { id: projectId };
  });
