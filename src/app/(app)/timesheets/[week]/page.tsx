import { IconChevronLeft } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { canEditTimesheet } from "@/actions/timesheets/canEditTimesheet";
import { getSelectableProjects } from "@/actions/timesheets/getSelectableProjects";
import { getTimesheet } from "@/actions/timesheets/getTimesheet";
import { TimesheetWeek } from "@/components/timesheets/timesheet-week";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { getWeekDays, getWeekStart } from "@/lib/timesheet-week";

export const metadata: Metadata = { title: "Timesheet" };

function BackLink() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 w-fit text-muted-foreground"
      render={<Link href="/timesheets" />}
    >
      <IconChevronLeft />
      All timesheets
    </Button>
  );
}

export default async function TimesheetWeekPage({
  params,
}: {
  params: Promise<{ week: string }>;
}) {
  const { week } = await params;
  // Normalize any date in the target week to its ISO-Monday key.
  const weekStartDate = getWeekStart(week);
  const weekDays = getWeekDays(weekStartDate);

  const [staffId, user] = await Promise.all([
    getCurrentStaffId(),
    getCurrentUser(),
  ]);

  if (!staffId || !user) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <BackLink />
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
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <BackLink />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            Week of {formatDate(weekDays[0])} – {formatDate(weekDays[6])}
          </h2>
        </div>
        <Badge variant={sheet.status === "submitted" ? "secondary" : "outline"}>
          {sheet.status === "submitted" ? "Submitted" : "Draft"}
        </Badge>
      </header>

      <TimesheetWeek
        key={weekStartDate}
        staffId={staffId}
        weekStartDate={weekStartDate}
        weekDays={weekDays}
        status={sheet.status}
        initialEntries={sheet.entries}
        projects={projects}
        canEdit={canEdit}
      />
    </div>
  );
}
