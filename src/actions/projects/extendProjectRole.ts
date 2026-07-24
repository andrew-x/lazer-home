"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { opportunities, projectRoles } from "@/lib/db/schema";
import { extendProjectRoleSchema } from "./extendProjectRole.schema";

/**
 * Extend an existing role — the planner's "add to an existing role + staff
 * allocation". Reads the source role's staff/type/name and inserts a **new**
 * tentative segment (its own `project_roles` row sharing the `staffId`) tagged
 * with this opportunity; the planner renders it as its own role row, editable
 * for this deal. Gated on `projects.edit`.
 *
 * The source role must be **confirmed** (you extend committed allocations, not
 * speculative ones) and must live on **this opportunity's** project — you can
 * only extend within the project you're planning against. It may belong to
 * another opportunity (extending someone's existing allocation).
 */
export const extendProjectRole = secureActionClient
  .metadata({
    action: "extend-project-role",
    permission: { projects: ["edit"] },
  })
  .inputSchema(extendProjectRoleSchema)
  .action(async ({ parsedInput }) => {
    const { sourceRoleId, opportunityId } = parsedInput;

    const newRoleId = generateId("proj-role");

    await db.transaction(async (tx) => {
      const [opportunity] = await tx
        .select({ projectId: opportunities.projectId })
        .from(opportunities)
        .where(eq(opportunities.id, opportunityId))
        .limit(1);
      if (!opportunity?.projectId) {
        throw new UserSafeActionError(
          "Associate or create a project for this opportunity first.",
        );
      }

      const [source] = await tx
        .select({
          projectId: projectRoles.projectId,
          staffId: projectRoles.staffId,
          status: projectRoles.status,
          lineOfBusiness: projectRoles.lineOfBusiness,
          description: projectRoles.description,
          roleType: projectRoles.roleType,
        })
        .from(projectRoles)
        .where(eq(projectRoles.id, sourceRoleId))
        .limit(1);
      if (!source) {
        throw new UserSafeActionError("That role no longer exists.");
      }
      if (source.projectId !== opportunity.projectId) {
        throw new UserSafeActionError(
          "You can only extend a role on this opportunity's project.",
        );
      }
      if (source.status !== "confirmed") {
        throw new UserSafeActionError("You can only extend a confirmed role.");
      }

      await tx.insert(projectRoles).values({
        id: newRoleId,
        projectId: opportunity.projectId,
        opportunityId,
        status: "tentative",
        // Share the source role's person and identity — this is a continuation.
        staffId: source.staffId,
        lineOfBusiness: source.lineOfBusiness,
        description: source.description,
        roleType: source.roleType,
        startDate: parsedInput.startDate,
        endDate: parsedInput.endDate,
        hoursPerDay: parsedInput.hoursPerDay,
      });
    });

    revalidatePath("/opportunities");
    revalidatePath("/projects");
    return { id: newRoleId };
  });
