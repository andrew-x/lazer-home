import {
  allocationsFilterOptions,
  getAllocationsGrid,
} from "@/actions/allocations/getAllocationsGrid";
import { AllocationsPlanner } from "@/components/allocations/allocations-planner";

export const metadata = { title: "Allocations" };

export default async function AllocationsPage() {
  const data = await getAllocationsGrid();

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          Allocations
        </h2>
        <p className="text-sm text-muted-foreground">
          Who's staffed on what, week by week.
        </p>
      </header>
      <AllocationsPlanner
        data={data}
        lineOfBusinessOptions={allocationsFilterOptions.lineOfBusiness}
        roleOptions={allocationsFilterOptions.role}
        employmentTypeOptions={allocationsFilterOptions.employmentType}
      />
    </div>
  );
}
