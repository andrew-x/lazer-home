import { revalidatePath } from "next/cache";

/**
 * Revalidate every page that renders a project or its roles after a mutation.
 * Mirrors CRM's `revalidateCompany`/`revalidateContact` so each project write
 * refreshes the same set:
 *
 * - `/projects` — the project card grid (name, status, delivery managers).
 * - `/projects/[id]` — the project's own detail page.
 * - `/opportunities` — a project's name and delivery managers show on the
 *   opportunity planner, and a role change moves that opportunity's plan.
 * - `/allocations` — project roles *are* the allocations grid's rows, which is
 *   why `allocateStaffToRole` revalidates the same set.
 *
 * Because a project's status and lines of business are derived from its roles in
 * the same read (`getProjectPlan`), one call refreshes the status badge, the
 * lines-of-business row, the timeline and the summary tiles together.
 */
export function revalidateProject(projectId: string): void {
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/opportunities");
  revalidatePath("/allocations");
}
