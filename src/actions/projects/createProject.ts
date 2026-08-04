"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { opportunityHasProject } from "@/actions/crm/opportunityHasProject";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { opportunities, projectRoles, projects } from "@/lib/db/schema";
import { createProjectSchema } from "./createProject.schema";
import { projectBudgetColumns } from "./projectBudgetWrite";

/**
 * Create a project with its budget and staffing roles (one transaction). Gated on
 * `projects.edit`. The company must already exist (picked via its own search); this
 * only consumes ids. Per-role date and hours rules are enforced by
 * `createProjectSchema`, and the billing shape by `projectBudgetSchema` plus the
 * `projects_budget_shape` check constraint.
 *
 * Delivery managers need no separate input: one of `roles` with
 * `roleType: "DELIVERY"` is what names who runs the engagement (ADR 0069).
 */
export const createProject = secureActionClient
  .metadata({
    action: "create-project",
    permission: { projects: ["edit"] },
  })
  .inputSchema(createProjectSchema)
  .action(async ({ parsedInput }) => {
    const { opportunityId } = parsedInput;

    // An opportunity has at most one project. Check first for a friendly
    // message ahead of setting `opportunities.projectId`.
    if (opportunityId && (await opportunityHasProject(opportunityId))) {
      throw new UserSafeActionError("This opportunity already has a project.");
    }

    const projectId = generateId("proj");

    await db.transaction(async (tx) => {
      await tx.insert(projects).values({
        id: projectId,
        name: parsedInput.name,
        companyId: parsedInput.companyId,
        ...projectBudgetColumns(parsedInput.budget),
      });

      // Link the opportunity to this new project (the CRM → delivery link now
      // lives on `opportunities`). The `is null` predicate makes this the
      // atomic guard for "one project per opportunity" now that a mutable
      // column, not a unique index, holds the link: a concurrent create that
      // linked first leaves 0 rows updated here, so this one throws and its
      // whole project insert rolls back — no orphaned project.
      if (opportunityId) {
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
          // 0 rows: either the opportunity vanished or it was linked
          // concurrently. Disambiguate for a precise message.
          const [current] = await tx
            .select({ projectId: opportunities.projectId })
            .from(opportunities)
            .where(eq(opportunities.id, opportunityId))
            .limit(1);
          throw new UserSafeActionError(
            current
              ? "This opportunity already has a project."
              : "That opportunity no longer exists.",
          );
        }
      }

      if (parsedInput.roles.length > 0) {
        await tx.insert(projectRoles).values(
          parsedInput.roles.map((role) => ({
            id: generateId("proj-role"),
            projectId,
            // Null ⇒ placeholder/open position.
            staffId: role.staffId ?? null,
            // Tag roles created from an opportunity with it (provenance). They
            // start tentative (schema default); auto-confirm when the deal wins.
            opportunityId: opportunityId ?? null,
            lineOfBusiness: role.lineOfBusiness,
            description: role.description,
            roleType: role.roleType,
            startDate: role.startDate,
            endDate: role.endDate,
            hoursPerDay: role.hoursPerDay,
            // Already snapshotted from the rate card by `snapshotBillRate`, so this
            // is always a concrete number — never fall back to the card here.
            billRate: role.billRate,
          })),
        );
      }
    });

    revalidatePath("/projects");
    // A project linked to an opportunity changes the board's `hasProject`.
    revalidatePath("/opportunities");
    return { id: projectId };
  });
