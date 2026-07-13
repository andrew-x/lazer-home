import type { Metadata } from "next";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { canEditTimesheet } from "@/actions/timesheets/canEditTimesheet";
import { getSelectableProjects } from "@/actions/timesheets/getSelectableProjects";
import { getTimesheet } from "@/actions/timesheets/getTimesheet";
import { TimesheetWeek } from "@/components/timesheets/timesheet-week";
import { getCurrentUser } from "@/lib/auth";
import {
  currentWeekStart,
  getWeekDays,
  getWeekStart,
} from "@/lib/timesheet-week";

export const metadata: Metadata = { title: "Timesheets" };

type SearchParams = Record<string, string | string[] | undefined>;

/** Resolve the `?week=` param to an ISO-Monday week start; default this week. */
function parseWeek(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return getWeekStart(raw);
  return currentWeekStart();
}

function Header() {
  return (
    <header>
      <h2 className="font-heading text-xl font-semibold tracking-tight">
        Timesheets
      </h2>
      <p className="text-sm text-muted-foreground">
        Log your hours per day against projects and non-billable work, up to 8
        hours a day.
      </p>
    </header>
  );
}

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const weekStartDate = parseWeek(params.week);

  const [staffId, user] = await Promise.all([
    getCurrentStaffId(),
    getCurrentUser(),
  ]);

  if (!staffId || !user) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <Header />
        <p className="text-sm text-muted-foreground">
          Your account isn't linked to a staff profile yet, so there's no
          timesheet to show. Contact an admin to get set up.
        </p>
      </div>
    );
  }

  const [timesheet, projects, canEdit] = await Promise.all([
    getTimesheet(staffId, weekStartDate),
    getSelectableProjects(),
    canEditTimesheet(user, { staffId, weekStartDate }),
  ]);

  // The viewer's own timesheet always resolves (an empty draft when unsaved).
  const sheet = timesheet ?? {
    status: "draft" as const,
    submittedAt: null,
    entries: [],
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <Header />
      <TimesheetWeek
        key={weekStartDate}
        staffId={staffId}
        weekStartDate={weekStartDate}
        weekDays={getWeekDays(weekStartDate)}
        status={sheet.status}
        initialEntries={sheet.entries}
        projects={projects}
        canEdit={canEdit}
      />
    </div>
  );
}
