import {
  IconAlertTriangle,
  IconCalendarOff,
  IconChartBar,
  IconClock,
} from "@tabler/icons-react";
import type { Metadata } from "next";
import { getAllocationsGrid } from "@/actions/allocations/getAllocationsGrid";
import { getMyAllocations } from "@/actions/allocations/getMyAllocations";
import { getCurrentStaffIdentity } from "@/actions/staff/getCurrentStaffIdentity";
import { getStaffPto } from "@/actions/staff/getStaffPto";
import { getStaffUtilization } from "@/actions/timesheets/getStaffUtilization";
import { HomeSection } from "@/components/home/home-section";
import { LazerStatusSection } from "@/components/home/lazer-status-section";
import { MyAllocationsTable } from "@/components/home/my-allocations-table";
import { InlineNotice } from "@/components/inline-notice";
import { StatCard } from "@/components/stat-card";
import { formatPercent } from "@/lib/format/format";
import { currentLoadPercent } from "@/lib/home/my-work";
import { buildOrgStatus } from "@/lib/home/org-status";
import { summarizePtoYear } from "@/lib/staff/pto-year";
import { currentDay, currentWeekStart } from "@/lib/timesheets/timesheet-week";
import { computeUtilization } from "@/lib/timesheets/utilization";

export const metadata: Metadata = { title: "Home" };

/**
 * The home dashboard, in two halves that measure **deliberately different things**.
 * This is the design, not an inconsistency to reconcile:
 *
 * - **Your Status — year to date.** Your own utilization is a cumulative fact about
 *   your year, from submitted timesheets, 1 January through today. A point-in-time
 *   personal figure would be noise: it would swing on a single day's logging.
 * - **Lazer Status — point in time.** The organization's question is *right now, how
 *   much of the bench is working?*, answered from the **staffing plan** as of today.
 *   A year-to-date org figure buries exactly what a staffing lead needs, and would
 *   inherit partial timesheet coverage as though it were low utilization.
 *
 * Because both halves would otherwise be called "utilization", **every figure must
 * name its window** — the bare word is ambiguous here. Don't unify the two: doing so
 * destroys one of the two answers. (`/reporting/utilization` is a third thing
 * again: plan reconciled *against* actuals over a chosen range — ADR 0062.)
 *
 * The two sections are sibling async Server Components rather than one top-level
 * `Promise.all`, so their reads run concurrently. Lazer Status hands its folded
 * payload to a Client Component for filtering; see the disclosure note in
 * `@/lib/home/org-status` before touching that payload.
 */
export default function HomePage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <HomeHeading />
      <YourStatusSection />
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
        Your year so far, and where the org stands today.
      </p>
    </div>
  );
}

async function YourStatusSection() {
  const today = currentDay();
  const year = Number(today.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const { staffId, roles, managedProjects } = await getMyAllocations();

  // The `(app)` layout redirects anyone without an active staff record, so this
  // is defense in depth rather than an expected state — but `getCurrentStaffId`
  // is nullable and zeros here would read as "you did nothing".
  if (!staffId) {
    return (
      <HomeSection title="Your Status">
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

  const load = currentLoadPercent(roles, today);

  const ptoYear = summarizePtoYear(
    [...(pto?.upcoming ?? []), ...(pto?.past ?? [])],
    year,
    today,
  );

  const rates = computeUtilization([utilization.hours], [utilization.plan]);

  return (
    <HomeSection
      title="Your Status"
      description="Your work this year — 1 January to today, from your timesheets."
    >
      <div className="grid gap-4 sm:grid-cols-3">
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
              ? `Billable share of hours logged · YTD, ${utilization.weeksLogged} ${utilization.weeksLogged === 1 ? "week" : "weeks"} in ${year}`
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
              : `Confirmed work against capacity · YTD`
          }
          icon={IconChartBar}
        />
      </div>

      <MyAllocationsTable
        roles={roles}
        managedProjects={managedProjects}
        today={today}
      />
    </HomeSection>
  );
}

/**
 * Everything here comes from one read. `getAllocationsGrid` already carries staff
 * (with home line of business, discipline and employment type), every live role
 * span (with the *work's* line of business), the open positions, and approved
 * leave — so five widgets and three filters cost one set of queries, shared with
 * `/allocations` through `React.cache`.
 */
async function OrganizationSection() {
  const grid = await getAllocationsGrid();

  const status = buildOrgStatus(
    grid.staff,
    grid.roles,
    grid.openRoles,
    grid.timeOff,
    currentDay(),
    currentWeekStart(),
  );

  return <LazerStatusSection status={status} />;
}
