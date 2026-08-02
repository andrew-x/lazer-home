import {
  allocationsFilterOptions,
  getAllocationsGrid,
} from "@/actions/allocations/getAllocationsGrid";
import {
  getProjectAllocationsGrid,
  projectAllocationsFilterOptions,
} from "@/actions/allocations/getProjectAllocationsGrid";
import { AllocationsPlanner } from "@/components/allocations/allocations-planner";
import { AllocationsViewToggle } from "@/components/allocations/allocations-view-toggle";
import { ProjectAllocationsPlanner } from "@/components/allocations/project-allocations-planner";
import { firstParam, type SearchParams } from "@/lib/core/list-href";

export const metadata = { title: "Allocations" };

/**
 * The planner, in two orientations. `?view=project` pivots the grid from people
 * to projects; the two views share no data — one is keyed by person and needs
 * PTO, the other is keyed by project and needs the open roles the staff read
 * filters out — so only the chosen view's read runs.
 */
export default async function AllocationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // Unknown values fall back to the staff view, matching the staff page.
  const view = firstParam(params.view) === "project" ? "project" : "staff";

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            Allocations
          </h2>
          <p className="text-sm text-muted-foreground">
            {view === "project"
              ? "How each project is staffed, role by role — and where the gaps are."
              : "Who's staffed on what, week by week."}
          </p>
        </div>
        <AllocationsViewToggle current={view} params={params} />
      </header>
      {view === "project" ? (
        <ProjectAllocationsPlanner
          data={await getProjectAllocationsGrid()}
          lineOfBusinessOptions={projectAllocationsFilterOptions.lineOfBusiness}
          roleTypeOptions={projectAllocationsFilterOptions.roleType}
        />
      ) : (
        <AllocationsPlanner
          data={await getAllocationsGrid()}
          lineOfBusinessOptions={allocationsFilterOptions.lineOfBusiness}
          roleOptions={allocationsFilterOptions.role}
          employmentTypeOptions={allocationsFilterOptions.employmentType}
        />
      )}
    </div>
  );
}
