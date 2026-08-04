"use server";

import { eq } from "drizzle-orm";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { projects } from "@/lib/db/schema";
import { revalidateProject } from "./revalidate";
import { updateProjectSchema } from "./updateProject.schema";

/**
 * Rename a project from the planner's Edit dialog. Gated on `projects.edit`,
 * mirroring `createProject`.
 *
 * Almost everything about a project is derived from its roles — its status, its
 * lines of business, and (since ADR 0069) its delivery managers — so the name is
 * all there is to edit here. Roles have their own per-role actions, and the budget
 * has `updateProjectBudget`.
 */
export const updateProject = secureActionClient
  .metadata({
    action: "update-project",
    permission: { projects: ["edit"] },
  })
  .inputSchema(updateProjectSchema)
  .action(async ({ parsedInput }) => {
    const { projectId, name } = parsedInput;

    await db.update(projects).set({ name }).where(eq(projects.id, projectId));

    revalidateProject(projectId);
    return { id: projectId };
  });
