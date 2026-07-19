"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { projectDeliveryManagers, projects } from "@/lib/db/schema";
import { updateProjectSchema } from "./updateProject.schema";

/**
 * Edit a project's top-level fields (name, delivery managers) from the planner's
 * Edit dialog. Gated on `projects.edit`, mirroring `createProject`. A project's
 * status and lines of business are derived from its roles, so they aren't edited
 * here. Delivery managers are reconciled with set-semantics: clear the project's
 * junction rows and re-insert the deduped selection. Roles are not touched here —
 * they have their own per-role actions.
 */
export const updateProject = secureActionClient
  .metadata({
    action: "update-project",
    permission: { projects: ["edit"] },
  })
  .inputSchema(updateProjectSchema)
  .action(async ({ parsedInput }) => {
    const { projectId, name } = parsedInput;
    // Dedupe so a duplicate can't trip the junction unique index.
    const deliveryManagerIds = [...new Set(parsedInput.deliveryManagerIds)];

    await db.transaction(async (tx) => {
      await tx.update(projects).set({ name }).where(eq(projects.id, projectId));

      // Set-semantics: clear this project's delivery managers, then re-add the
      // current selection.
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

    revalidatePath("/projects");
    // A project's name/delivery managers show on the opportunity planner too.
    revalidatePath("/opportunities");
    return { id: projectId };
  });
