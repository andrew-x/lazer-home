import type { Metadata } from "next";
import {
  getStaffDirectory,
  staffDirectoryFilterOptions,
} from "@/actions/staff/getStaffDirectory";
import { OrgChart } from "@/components/staff/org-chart";
import { StaffDirectory } from "@/components/staff/staff-directory";
import { StaffViewToggle } from "@/components/staff/staff-view-toggle";
import { firstParam, type SearchParams } from "@/lib/core/list-href";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // Unknown values fall back to the directory, matching the opportunities page.
  const view = firstParam(params.view) === "org" ? "org" : "directory";
  const entries = await getStaffDirectory();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            Staff
          </h2>
          <p className="text-sm text-muted-foreground">
            {view === "org"
              ? "Who reports to whom. Filter to narrow the chart to a team."
              : "Browse the team. Search and filter to find someone."}
          </p>
        </div>
        <StaffViewToggle current={view} params={params} />
      </header>
      {view === "org" ? (
        <OrgChart
          entries={entries}
          lineOfBusinessOptions={staffDirectoryFilterOptions.lineOfBusiness}
          roleOptions={staffDirectoryFilterOptions.role}
        />
      ) : (
        <StaffDirectory
          entries={entries}
          lineOfBusinessOptions={staffDirectoryFilterOptions.lineOfBusiness}
          roleOptions={staffDirectoryFilterOptions.role}
          typeOptions={staffDirectoryFilterOptions.employmentType}
        />
      )}
    </div>
  );
}
