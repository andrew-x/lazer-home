import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import {
  companies,
  projectDeliveryManagers,
  projectRoles,
  projects,
} from "@/lib/db/schema";
import {
  PROJECT_ROLE_TYPE_LABELS,
  type ProjectRoleType,
} from "@/lib/project-role-type";
import type { ProjectStatus } from "@/lib/project-status";

/** A project this person is involved with, plus how they're involved. */
export type StaffProjectSummary = {
  id: string;
  name: string;
  companyName: string;
  status: ProjectStatus;
  /**
   * The person's relationship(s) to the project, as human-facing labels —
   * "Delivery manager" and/or role disciplines ("Engineer", "Designer", …),
   * deduped and delivery-manager first.
   */
  relationships: string[];
};

/** Delivery-manager label, kept first in the relationships list. */
const DELIVERY_MANAGER_LABEL = "Delivery manager";

/**
 * Projects a staff member has worked on — those where they hold a staffing line
 * (`project_roles`) OR run the project as a delivery manager
 * (`project_delivery_managers`). One row per project, merging both
 * relationships. For SSR; NOT ownership-scoped (like `getStaffProfile`, auth is
 * provided by the `(app)` layout). Sorted by project name.
 */
export async function getStaffProjects(
  staffId: string,
): Promise<StaffProjectSummary[]> {
  const [roleRows, managerRows] = await Promise.all([
    db
      .select({
        id: projects.id,
        name: projects.name,
        status: projects.status,
        companyName: companies.name,
        roleType: projectRoles.roleType,
      })
      .from(projectRoles)
      .innerJoin(projects, eq(projects.id, projectRoles.projectId))
      .innerJoin(companies, eq(companies.id, projects.companyId))
      .where(eq(projectRoles.staffId, staffId)),
    db
      .select({
        id: projects.id,
        name: projects.name,
        status: projects.status,
        companyName: companies.name,
      })
      .from(projectDeliveryManagers)
      .innerJoin(projects, eq(projects.id, projectDeliveryManagers.projectId))
      .innerJoin(companies, eq(companies.id, projects.companyId))
      .where(eq(projectDeliveryManagers.staffId, staffId)),
  ]);

  // Merge both relationships into one row per project. A Map preserves the first
  // sighting; relationships accumulate in a Set so a person with several roles
  // of the same discipline (or a role + delivery-manager seat) lists each once.
  const byProject = new Map<
    string,
    Omit<StaffProjectSummary, "relationships"> & { relationships: Set<string> }
  >();

  const upsert = (row: {
    id: string;
    name: string;
    status: ProjectStatus;
    companyName: string;
  }) => {
    let entry = byProject.get(row.id);
    if (!entry) {
      entry = { ...row, relationships: new Set<string>() };
      byProject.set(row.id, entry);
    }
    return entry;
  };

  for (const row of managerRows) {
    upsert(row).relationships.add(DELIVERY_MANAGER_LABEL);
  }
  for (const row of roleRows) {
    upsert(row).relationships.add(
      PROJECT_ROLE_TYPE_LABELS[row.roleType as ProjectRoleType],
    );
  }

  return Array.from(byProject.values())
    .map((entry) => ({
      ...entry,
      // Delivery manager first, then disciplines alphabetically.
      relationships: Array.from(entry.relationships).sort((a, b) => {
        if (a === DELIVERY_MANAGER_LABEL) return -1;
        if (b === DELIVERY_MANAGER_LABEL) return 1;
        return a.localeCompare(b);
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
