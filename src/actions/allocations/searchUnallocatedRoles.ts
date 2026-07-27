"use server";

import { and, asc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { secureActionClient } from "@/lib/core/action";
import { escapeLike } from "@/lib/core/like";
import { SEARCH_LIMIT, searchQuerySchema } from "@/lib/core/search";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import { db } from "@/lib/db/db";
import { projectRoles, projects } from "@/lib/db/schema";
import type { ProjectRoleType } from "@/lib/projects/project-role-type";

/**
 * One open (unallocated) project role — a `project_roles` row with no person yet.
 * Richer than the generic `{ id, name }` search option because the allocate
 * dialog prefills the date range + hours/day from the role the user picks.
 */
export type UnallocatedRoleOption = {
  id: string;
  projectId: string;
  projectName: string;
  description: string | null;
  roleType: ProjectRoleType;
  lineOfBusiness: LineOfBusiness;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
};

/**
 * Type-ahead over **open positions** — roles with `staffId IS NULL` in a live
 * planning state (`tentative`/`confirmed`) — backing the role picker in the
 * allocations-view "Allocate" dialog. Matches on project name OR role
 * description; blank query → nothing (mirrors `searchProjects`). Gated on
 * `projects.edit`: surfacing who *could* be staffed is a delivery decision.
 */
export const searchUnallocatedRoles = secureActionClient
  .metadata({
    action: "search-unallocated-roles",
    permission: { projects: ["edit"] },
  })
  .inputSchema(searchQuerySchema)
  .action(
    async ({ parsedInput: { query } }): Promise<UnallocatedRoleOption[]> => {
      if (query === "") return [];

      const pattern = `%${escapeLike(query)}%`;
      return db
        .select({
          id: projectRoles.id,
          projectId: projectRoles.projectId,
          projectName: projects.name,
          description: projectRoles.description,
          roleType: projectRoles.roleType,
          lineOfBusiness: projectRoles.lineOfBusiness,
          startDate: projectRoles.startDate,
          endDate: projectRoles.endDate,
          hoursPerDay: projectRoles.hoursPerDay,
        })
        .from(projectRoles)
        .innerJoin(projects, eq(projectRoles.projectId, projects.id))
        .where(
          and(
            isNull(projectRoles.staffId),
            inArray(projectRoles.status, ["tentative", "confirmed"]),
            or(
              ilike(projects.name, pattern),
              ilike(projectRoles.description, pattern),
            ),
          ),
        )
        .orderBy(asc(projects.name))
        .limit(SEARCH_LIMIT);
    },
  );
