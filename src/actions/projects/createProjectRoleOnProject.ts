"use server";

import { eq } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { projectRoles, projects } from "@/lib/db/schema";
import { createProjectRoleOnProjectSchema } from "./createProjectRoleOnProject.schema";
import { revalidateProject } from "./revalidate";

/**
 * Add a staffing role to a project from the project detail page — the delivery-side
 * counterpart of `createProjectRole` (which adds a role to an opportunity's plan).
 * Gated on `projects.edit`. The role lands on the given project with **no**
 * `opportunityId`: it belongs to the engagement, not to a deal. It's created
 * `tentative`, like every other new role — status stays system-driven (a role
 * becomes confirmed when its opportunity is won).
 */
export const createProjectRoleOnProject = secureActionClient
  .metadata({
    action: "create-project-role-on-project",
    permission: { projects: ["edit"] },
  })
  .inputSchema(createProjectRoleOnProjectSchema)
  .action(async ({ parsedInput }) => {
    const { projectId } = parsedInput;

    const projectRows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    assertRowExists(projectRows, "project");

    const roleId = generateId("proj-role");
    await db.insert(projectRoles).values({
      id: roleId,
      projectId,
      opportunityId: null,
      status: "tentative",
      lineOfBusiness: parsedInput.lineOfBusiness,
      staffId: parsedInput.staffId ?? null,
      description: parsedInput.description,
      roleType: parsedInput.roleType,
      startDate: parsedInput.startDate,
      endDate: parsedInput.endDate,
      hoursPerDay: parsedInput.hoursPerDay,
      // Snapshotted by `snapshotBillRate` when the form left it blank.
      billRate: parsedInput.billRate,
    });

    revalidateProject(projectId);
    return { id: roleId };
  });
