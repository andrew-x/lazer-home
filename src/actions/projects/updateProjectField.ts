"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidateCompany } from "@/actions/crm/revalidate";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import {
  companies,
  opportunities,
  projectDeliveryManagers,
  projects,
} from "@/lib/db/schema";
import { revalidateProject } from "./revalidate";
import { updateProjectFieldSchema } from "./updateProjectField.schema";

/**
 * Edit a *single* field of a project from its detail page's inline fields (name,
 * company, delivery managers). Gated on `projects.edit`. A discriminated union on
 * `field`: each variant writes only the slice that changed instead of re-sending the
 * whole record, so a concurrent edit to another field isn't clobbered and a name
 * change doesn't rewrite the delivery-manager junction (mirrors
 * `updateCompanyField`).
 *
 * The whole-record `updateProject` still exists for the opportunity planner's Edit
 * dialog — the same split the CRM has between `EditCompanyDialog` and the company
 * detail page's inline fields.
 *
 * **Moving a project between companies** is the one variant with a data-integrity
 * rule of its own. `associateOpportunityProject` enforces that an opportunity and
 * its project share a company; nothing re-checks that afterwards, so re-parenting a
 * project would silently strand any linked deal on a project belonging to someone
 * else's client. The `company` case therefore refuses while such a link exists —
 * unlink or move the opportunity first. Note the move does *not* touch logged time
 * (`timeEntries.projectId` references the project, not the company), so hours
 * already booked follow the project to its new client — deliberate, since that is
 * what re-parenting means for billing.
 */
export const updateProjectField = secureActionClient
  .metadata({
    action: "update-project-field",
    permission: { projects: ["edit"] },
  })
  .inputSchema(updateProjectFieldSchema)
  .action(async ({ parsedInput }) => {
    const { projectId } = parsedInput;
    // Set by the `company` case so the *previous* client's detail page (which
    // lists its projects) is revalidated alongside the new one.
    let previousCompanyId: string | null = null;

    switch (parsedInput.field) {
      case "name": {
        // `.returning()`-guarded so a project deleted out from under the edit
        // surfaces as a clean error rather than a silent no-op.
        const rows = await db
          .update(projects)
          .set({ name: parsedInput.name })
          .where(eq(projects.id, projectId))
          .returning({ id: projects.id });
        assertRowExists(rows, "project");
        break;
      }
      case "company": {
        const { companyId } = parsedInput;

        previousCompanyId = await db.transaction(async (tx) => {
          const projectRows = await tx
            .select({ companyId: projects.companyId })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);
          assertRowExists(projectRows, "project");
          const previous = projectRows[0].companyId;
          if (previous === companyId) return previous;

          const companyRows = await tx
            .select({ id: companies.id })
            .from(companies)
            .where(eq(companies.id, companyId))
            .limit(1);
          assertRowExists(companyRows, "company");

          // A linked opportunity must share its project's company. Nothing
          // re-checks that after association, so refuse rather than strand it.
          const [strandedOpportunity] = await tx
            .select({ name: opportunities.name })
            .from(opportunities)
            .where(
              and(
                eq(opportunities.projectId, projectId),
                ne(opportunities.companyId, companyId),
              ),
            )
            .limit(1);
          if (strandedOpportunity) {
            throw new UserSafeActionError(
              `This project delivers the opportunity "${strandedOpportunity.name}", which belongs to a different company. Unlink or move that opportunity before changing the project's company.`,
            );
          }

          await tx
            .update(projects)
            .set({ companyId })
            .where(eq(projects.id, projectId));

          return previous;
        });
        break;
      }
      case "deliveryManagers": {
        // Dedupe so a duplicate can't trip the junction unique index.
        const deliveryManagerIds = [...new Set(parsedInput.deliveryManagerIds)];

        await db.transaction(async (tx) => {
          const rows = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);
          assertRowExists(rows, "project");

          // Set-semantics, as in `updateProject`: clear this project's delivery
          // managers, then re-add the current selection.
          await tx
            .delete(projectDeliveryManagers)
            .where(eq(projectDeliveryManagers.projectId, projectId));

          if (deliveryManagerIds.length > 0) {
            await tx.insert(projectDeliveryManagers).values(
              deliveryManagerIds.map((staffId) => ({
                id: generateId("proj-dm"),
                projectId,
                staffId,
              })),
            );
          }
        });
        break;
      }
    }

    revalidateProject(projectId);
    if (parsedInput.field === "company") {
      // Both clients' detail pages list their projects.
      revalidateCompany(parsedInput.companyId);
      if (previousCompanyId && previousCompanyId !== parsedInput.companyId) {
        revalidateCompany(previousCompanyId);
      }
    }
    return { id: projectId };
  });
