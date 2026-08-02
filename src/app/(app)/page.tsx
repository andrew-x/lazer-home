import {
  IconAlertTriangle,
  IconBriefcase,
  IconCalendarOff,
  IconChartBar,
  IconClock,
} from "@tabler/icons-react";
import type { Metadata } from "next";
import { getAllocationsGrid } from "@/actions/allocations/getAllocationsGrid";
import { getMyAllocations } from "@/actions/allocations/getMyAllocations";
import { getCurrentStaffIdentity } from "@/actions/staff/getCurrentStaffIdentity";
import { getStaffPto } from "@/actions/staff/getStaffPto";
import { getOrgUtilization } from "@/actions/timesheets/getOrgUtilization";
import { getStaffUtilization } from "@/actions/timesheets/getStaffUtilization";
import { AllocationTimeline } from "@/components/home/allocation-timeline";
import { AvailabilityPanel } from "@/components/home/availability-panel";
import { HomeSection } from "@/components/home/home-section";
import { UpcomingTimeOffPanel } from "@/components/home/upcoming-time-off-panel";
import { UtilizationPanel } from "@/components/home/utilization-panel";
import { InlineNotice } from "@/components/inline-notice";
import { StatCard } from "@/components/stat-card";
import {
  buildAvailability,
  buildUpcomingTimeOff,
  UPCOMING_TIME_OFF_HORIZON_DAYS,
} from "@/lib/allocations/availability";
import { formatPercent } from "@/lib/format/format";
import {
  buildTimelineRows,
  pctOf,
  timelineWindow,
} from "@/lib/home/allocation-timeline";
import {
  activeProjects,
  currentLoadPercent,
  nextStartDate,
} from "@/lib/home/my-work";
import { summarizePtoYear } from "@/lib/staff/pto-year";
import { currentDay, currentWeekStart } from "@/lib/timesheets/timesheet-week";
import {
  computeUtilization,
  splitByEmploymentType,
} from "@/lib/timesheets/utilization";

export const metadata: Metadata = { title: "Home" };

/**
 * The home dashboard: a **point-in-time** snapshot of the consultancy. Utilization
 * is year to date — 1 January through today, never beyond. PTO is what you've
 * taken so far plus what's booked. The only forward-looking widgets are the two
 * that are inherently forecasts — availability over the next four weeks, and
 * upcoming leave.
 *
 * The two sections are sibling async Server Components rather than one top-level
 * `Promise.all`, so their reads run concurrently. There is no `<Suspense>`
 * boundary (the repo has none, and `(app)/loading.tsx` already covers the route);
 * if the organization reads ever measure slow, wrapping only that section is the
 * change to make — the personal reads are all `staffId`-indexed and cheap.
 */
export default function HomePage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <HomeHeading />
      <YourWorkSection />
      <OrganizationSection />
    </div>
  );
}

async function HomeHeading() {
  const identity = await getCurrentStaffIdentity();
  const firstName = identity?.name.split(" ")[0] ?? "there";
  return (
    <div>
      <h2 className="font-heading text-2xl font-semibold tracking-tight">
        Welcome back, {firstName}
      </h2>
      <p className="text-muted-foreground">
        Where your work stands, and how the org is tracking this year.
      </p>
    </div>
  );
}

async function YourWorkSection() {
  const today = currentDay();
  const year = Number(today.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const { staffId, roles, managedProjects } = await getMyAllocations();

  // The `(app)` layout redirects anyone without an active staff record, so this
  // is defense in depth rather than an expected state — but `getCurrentStaffId`
  // is nullable and zeros here would read as "you did nothing".
  if (!staffId) {
    return (
      <HomeSection title="Your work">
        <InlineNotice icon={IconAlertTriangle}>
          We couldn&apos;t find your staff record, so your personal figures
          aren&apos;t available.
        </InlineNotice>
      </HomeSection>
    );
  }

  const [pto, utilization] = await Promise.all([
    getStaffPto(staffId),
    getStaffUtilization(staffId, yearStart, today),
  ]);

  const projects = activeProjects(roles, managedProjects, today);
  const load = currentLoadPercent(roles, today);
  const nextStart = nextStartDate(roles, today);

  const ptoYear = summarizePtoYear(
    [...(pto?.upcoming ?? []), ...(pto?.past ?? [])],
    year,
    today,
  );

  const rates = computeUtilization([utilization.hours], [utilization.plan]);

  const window = timelineWindow(today);
  const { rows, hiddenCount } = buildTimelineRows(roles, today, window);

  return (
    <HomeSection
      title="Your work"
      description="Where your time is committed, and what you've logged this week."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active projects"
          value={projects.length === 0 ? "—" : String(projects.length)}
          hint={
            projects.length === 0
              ? nextStart
                ? "On the bench — next role starts soon"
                : "Not allocated right now"
              : projects.map((p) => p.projectName).join(" · ")
          }
          icon={IconBriefcase}
        />
        <StatCard
          label="PTO taken"
          value={`${ptoYear.takenDays} days`}
          hint={
            ptoYear.bookedDays > 0
              ? `+${ptoYear.bookedDays} booked · approved leave, ${year}`
              : `Approved leave, ${year}`
          }
          icon={IconCalendarOff}
        />
        <StatCard
          label="Utilization"
          value={formatPercent(rates.actual.rate)}
          hint={
            utilization.hours
              ? `Billable share of hours logged · ${utilization.weeksLogged} ${utilization.weeksLogged === 1 ? "week" : "weeks"} in ${year}`
              : `Nothing logged yet in ${year}`
          }
          icon={IconClock}
        />
        <StatCard
          label="Planned"
          value={formatPercent(rates.planned.rate)}
          hint={
            load > 100
              ? `Over-allocated — ${load}% committed today`
              : `Confirmed work against capacity, Jan 1 – today`
          }
          icon={IconChartBar}
        />
      </div>

      <AllocationTimeline
        rows={rows}
        window={window}
        todayPct={pctOf(today, window)}
        hiddenCount={hiddenCount}
      />
    </HomeSection>
  );
}

async function OrganizationSection() {
  const today = currentDay();
  const weekStart = currentWeekStart();
  const yearStart = `${today.slice(0, 4)}-01-01`;

  const [grid, org] = await Promise.all([
    getAllocationsGrid(),
    getOrgUtilization(yearStart, today),
  ]);

  const { overall, groups, headcount, logged } = splitByEmploymentType(
    org.records,
  );
  const { weeks, people } = buildAvailability(
    grid.staff,
    grid.roles,
    grid.timeOff,
    weekStart,
  );
  const upcomingLeave = buildUpcomingTimeOff(grid.staff, grid.timeOff, today);

  return (
    <HomeSection
      title="The organization"
      description="Capacity and utilization across everyone."
    >
      <UtilizationPanel
        rangeStart={org.rangeStart}
        rangeEnd={org.rangeEnd}
        overall={overall}
        groups={groups}
        headcount={headcount}
        logged={logged}
        nonBillableExcluded={org.nonBillableExcluded}
      />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <AvailabilityPanel
          weeks={weeks}
          people={people}
          hasStaff={people.length > 0}
        />
        <UpcomingTimeOffPanel
          rows={upcomingLeave}
          horizonDays={UPCOMING_TIME_OFF_HORIZON_DAYS}
        />
      </div>
    </HomeSection>
  );
}
