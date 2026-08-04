"use client";

import { useState } from "react";
import type { OrgPipeline } from "@/actions/crm/getOrgPipeline";
import { ALL, SelectFilter } from "@/components/form/filters";
import { AvailabilityPanel } from "@/components/home/availability-panel";
import { BorrowedStaffPanel } from "@/components/home/borrowed-staff-panel";
import { HomeSection } from "@/components/home/home-section";
import { PipelinePanel } from "@/components/home/pipeline-panel";
import { ProjectRolesPanel } from "@/components/home/project-roles-panel";
import { StaffingPanel } from "@/components/home/staffing-panel";
import { UpcomingTimeOffPanel } from "@/components/home/upcoming-time-off-panel";
import { UPCOMING_TIME_OFF_HORIZON_DAYS } from "@/lib/allocations/availability";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_LABELS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import type { EmploymentFilter, OrgStatus } from "@/lib/home/org-status";
import {
  filterByLineOfBusiness,
  groupRolesByProject,
  summarizeStaffing,
  UPCOMING_ROLES_HORIZON_DAYS,
} from "@/lib/home/org-status";

/**
 * "Lazer Status" — the whole organization, **as of today**, filterable by line of
 * business.
 *
 * ## Why this is a Client Component
 *
 * It is the first one on this route, which previously shipped zero client JS by
 * design. The trade was made deliberately: the section now has four controls (line
 * of business, availability week, and an employment type on each of Availability and
 * Staffing), and every one of them re-slices data that is *already fetched*. Pushing
 * them into the URL would mean a server
 * round trip and a full re-render to answer "who's free in three weeks" — a
 * question people ask by clicking through all five weeks in a row. This follows the
 * split `/reporting/utilization` already established: the range lives in the URL
 * because it bounds the query; the filters are client state because they don't.
 *
 * ## Disclosure
 *
 * Props of a Client Component are serialized into the page HTML for **every**
 * viewer. The payload is therefore built by `buildOrgStatus`, which whitelists
 * fields explicitly — see the disclosure note in `@/lib/home/org-status`. Never
 * pass raw `getAllocationsGrid` output here: it carries `allocationNotes`, which is
 * gated on `staff.edit`.
 *
 * ## One filter, one meaning
 *
 * The line-of-business filter matches each person's **home** line of business on
 * every panel, so "Fintech" consistently means the Fintech team — including where
 * they've been lent out (which is exactly what Borrowed staff is for). Filtering by
 * the *work's* line of business instead would make availability incoherent: a free
 * person is on no project and so has no work to match.
 *
 * **Pipeline is the one panel that can't obey that literally**, because a deal has no
 * person: it matches `opportunities.lineOfBusiness`, the deal's own. That's a
 * coherent reading of "the control names a line of business" rather than an
 * exception to it — the rule above is about not matching a *person's* work when the
 * person is the subject. Written down because the original rule reads as forbidding
 * this (ADR 0069 amends ADR 0063 §6). A card sitting under a band-scoping control
 * while ignoring it would be worse: unchanged numbers above a filtered list is the
 * classic filtered-dashboard bug.
 *
 * The **employment-type controls are the deliberate exception**, and there are two of
 * them: Availability's is an optional All/Full time/Hourly narrowing of who is free,
 * while Staffing's is a required two-way split of a figure that must not be blended
 * (see `StaffingPanel`). Don't hoist them into one section-level control — it would
 * either strip Availability's "All" or hand Staffing back the combined rate it exists
 * to avoid. Each sits inside the card it governs. Availability's state is lifted here
 * only because it shares a controlled shape with the week tabs beside it; Staffing's
 * lives in the panel, since nothing outside that card reads it.
 */
export function LazerStatusSection({
  status,
  pipeline,
}: {
  status: OrgStatus;
  pipeline: OrgPipeline;
}) {
  const [lineOfBusiness, setLineOfBusiness] = useState<LineOfBusiness | null>(
    null,
  );
  const [weekIndex, setWeekIndex] = useState(0);
  const [employmentType, setEmploymentType] = useState<EmploymentFilter>(null);

  const filtered = filterByLineOfBusiness(status, lineOfBusiness);
  const staffing = summarizeStaffing(filtered.people);
  // Selected, never recomputed: the read ships one server-side fold per filter
  // value, so a filtered pipeline figure can't drift from an unfiltered total
  // (ADR 0063 §6, satisfied by construction — see `getOrgPipeline`).
  const pipelineSummary =
    lineOfBusiness === null
      ? pipeline.all
      : pipeline.byLineOfBusiness[lineOfBusiness];
  const starting = groupRolesByProject(
    filtered.upcomingRoles.filter((role) => role.kind === "starting"),
  );
  const ending = groupRolesByProject(
    filtered.upcomingRoles.filter((role) => role.kind === "ending"),
  );

  return (
    <HomeSection
      title="Lazer Status"
      description="The whole organization, as it stands today."
      action={
        <SelectFilter
          label="Line of business"
          value={lineOfBusiness ?? ALL}
          options={LINE_OF_BUSINESS}
          labels={LINE_OF_BUSINESS_LABELS}
          onChange={(value) =>
            setLineOfBusiness(value === ALL ? null : (value as LineOfBusiness))
          }
        />
      }
    >
      <StaffingPanel model={staffing} today={status.today} />

      {/* Directly under Staffing: that card says whether the bench is working,
          this one says whether work is coming to keep it working. */}
      <PipelinePanel
        summary={pipelineSummary}
        displayCurrency={pipeline.displayCurrency}
        convertedFrom={pipeline.convertedFrom}
        rates={pipeline.rates}
        today={pipeline.today}
        weekStart={pipeline.weekStart}
        monthStart={pipeline.monthStart}
      />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <AvailabilityPanel
          people={filtered.people}
          weekStarts={status.weekStarts}
          weekIndex={weekIndex}
          onWeekIndexChange={setWeekIndex}
          employmentType={employmentType}
          onEmploymentTypeChange={setEmploymentType}
        />
        <UpcomingTimeOffPanel
          rows={filtered.leave}
          horizonDays={UPCOMING_TIME_OFF_HORIZON_DAYS}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ProjectRolesPanel
          title="Starting soon"
          groups={starting}
          horizonDays={UPCOMING_ROLES_HORIZON_DAYS}
          emptyLabel="starts"
        />
        <ProjectRolesPanel
          title="Ending soon"
          groups={ending}
          horizonDays={UPCOMING_ROLES_HORIZON_DAYS}
          emptyLabel="ends"
        />
      </div>

      <BorrowedStaffPanel rows={filtered.borrowed} />
    </HomeSection>
  );
}
