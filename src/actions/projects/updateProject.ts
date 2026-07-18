"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { projectDeliveryManagers, projects } from "@/lib/db/schema";
import { updateProjectSchema } from "./updateProject.schema";

/**
 * Edit a project's top-level fields (name, line of business, status, delivery
 * managers) from the planner. Gated on `projects.edit`, mirroring
 * `createProject`. Delivery managers are reconciled with set-semantics: clear
 * the project's junction rows and re-insert the deduped selection. Roles are not
 * touched here — they have their own per-role actions.
 */
export const updateProject = secureActionClient
  .metadata({
    action: "update-project",
    permission: { projects: ["edit"] },
  })
  .inputSchema(updateProjectSchema)
  .action(async ({ parsedInput }) => {
    // Dedupe so a duplicate can't trip the junction unique index.
    const deliveryManagerIds = [...new Set(parsedInput.deliveryManagerIds)];

    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({
          name: parsedInput.name,
          lineOfBusiness: parsedInput.lineOfBusiness,
          status: parsedInput.status,
        })
        .where(eq(projects.id, parsedInput.projectId));

      // Set-semantics: clear this project's delivery managers, then re-add the
      // current selection.
      await tx
        .delete(projectDeliveryManagers)
        .where(eq(projectDeliveryManagers.projectId, parsedInput.projectId));

      if (deliveryManagerIds.length > 0) {
        await tx.insert(projectDeliveryManagers).values(
          deliveryManagerIds.map((staffId) => ({
            id: generateId("proj-dm"),
            projectId: parsedInput.projectId,
            staffId,
          })),
        );
      }
    });

    revalidatePath("/projects");
    // A project's status/line of business shows on the opportunity planner too.
    revalidatePath("/opportunities");
    return { id: parsedInput.projectId };
  });
