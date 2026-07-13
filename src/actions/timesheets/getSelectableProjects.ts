import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { companies, projects } from "@/lib/db/schema";

/** A project option for the timesheet row picker. */
export type SelectableProject = {
  id: string;
  name: string;
  companyName: string;
};

/**
 * All projects (with their company name) offered as timesheet targets, sorted by
 * name. Project reads are open to any signed-in user (see the permissions doc),
 * and the page is already auth-gated, so no per-user scoping here. A person may
 * log against any project, not only ones they're allocated to (a resolved open
 * question — see docs/domains/timesheets.md).
 */
export async function getSelectableProjects(): Promise<SelectableProject[]> {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      companyName: companies.name,
    })
    .from(projects)
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .orderBy(asc(projects.name));
}
