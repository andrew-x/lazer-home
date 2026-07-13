"use server";

import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import {
  projectDeliveryManagers,
  projectRoles,
  projects,
} from "@/lib/db/schema";
import { createProjectSchema } from "./createProject.schema";

/**
 * Create a project with its delivery managers and staffing roles (one
 * transaction). Gated on `projects.edit`. The company must already exist (picked
 * via its own search); this only consumes ids. Per-role date and hours rules are
 * enforced by `createProjectSchema`.
 */
export const createProject = secureActionClient
  .metadata({
    action: "create-project",
    permission: { projects: ["edit"] },
  })
  .inputSchema(createProjectSchema)
  .action(async ({ parsedInput }) => {
    const projectId = generateId("proj");

    // Dedupe so a duplicate can't trip the junction unique index.
    const deliveryManagerIds = [...new Set(parsedInput.deliveryManagerIds)];

    await db.transaction(async (tx) => {
      await tx.insert(projects).values({
        id: projectId,
        name: parsedInput.name,
        companyId: parsedInput.companyId,
        lineOfBusiness: parsedInput.lineOfBusiness,
        opportunityId: parsedInput.opportunityId ?? null,
      });

      if (deliveryManagerIds.length > 0) {
        await tx.insert(projectDeliveryManagers).values(
          deliveryManagerIds.map((staffId) => ({
            id: generateId("proj-dm"),
            projectId,
            staffId,
          })),
        );
      }

      if (parsedInput.roles.length > 0) {
        await tx.insert(projectRoles).values(
          parsedInput.roles.map((role) => ({
            id: generateId("proj-role"),
            projectId,
            // Null ⇒ placeholder/open position.
            staffId: role.staffId ?? null,
            name: role.name,
            roleType: role.roleType,
            startDate: role.startDate,
            endDate: role.endDate,
            hoursPerDay: role.hoursPerDay,
          })),
        );
      }
    });

    revalidatePath("/projects");
    // A project linked to an opportunity changes the board's `hasProject`.
    revalidatePath("/opportunities");
    return { id: projectId };
  });
