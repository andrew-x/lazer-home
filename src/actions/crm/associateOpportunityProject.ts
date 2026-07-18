"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { opportunities, projects } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { associateOpportunityProjectSchema } from "./associateOpportunityProject.schema";

/**
 * Associate an opportunity with an **existing** project — the "extend an
 * existing project" half of the planner (the other half is `createProject`).
 * Many opportunities can point at one project (an original deal plus later
 * extensions / change requests).
 *
 * **Gated on `projects.edit`, not `crm.edit`:** although it writes an
 * `opportunities` column, choosing which project delivers a deal is a delivery
 * decision (a `sales` user must not self-associate) — consistent with
 * `createProject`.
 *
 * Enforces two invariants server-side (the picker is company-scoped, but a
 * hand-crafted request could still mismatch):
 * - **Same company:** the project and opportunity must share a company (finally
 *   closing the ADR 0019 gap now that any existing project can be picked).
 * - **At most one project per opportunity:** reject if the opportunity is
 *   already linked.
 */
export const associateOpportunityProject = secureActionClient
  .metadata({
    action: "associate-opportunity-project",
    permission: { projects: ["edit"] },
  })
  .inputSchema(associateOpportunityProjectSchema)
  .action(async ({ parsedInput: { opportunityId, projectId } }) => {
    const [opportunity] = await db
      .select({
        companyId: opportunities.companyId,
        projectId: opportunities.projectId,
      })
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId))
      .limit(1);
    if (!opportunity) {
      throw new UserSafeActionError("That opportunity no longer exists.");
    }
    if (opportunity.projectId) {
      throw new UserSafeActionError("This opportunity already has a project.");
    }

    const [project] = await db
      .select({ companyId: projects.companyId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) {
      throw new UserSafeActionError("That project no longer exists.");
    }
    if (project.companyId !== opportunity.companyId) {
      throw new UserSafeActionError(
        "A project must belong to the same company as the opportunity.",
      );
    }

    // The `is null` predicate is the atomic guard for "one project per
    // opportunity": if a concurrent link landed between the read above and this
    // write, 0 rows update and we reject rather than silently overwriting it.
    const [linked] = await db
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
      throw new UserSafeActionError("This opportunity already has a project.");
    }

    revalidatePath("/opportunities");
    return { id: opportunityId };
  });
