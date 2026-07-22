import type { Metadata } from "next";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { getTimesheetList } from "@/actions/timesheets/getTimesheetList";
import { TimesheetsList } from "@/components/timesheets/timesheets-list";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { isWithinEditWindow } from "@/lib/timesheets/timesheet-week";

export const metadata: Metadata = { title: "Timesheets" };

function Header() {
  return (
    <header>
      <h2 className="font-heading text-xl font-semibold tracking-tight">
        Timesheets
      </h2>
      <p className="text-sm text-muted-foreground">
        Your weekly time. Open a week to log hours against projects and
        non-billable work, up to 8 hours a day.
      </p>
    </header>
  );
}

export default async function TimesheetsPage() {
  const [staffId, user] = await Promise.all([
    getCurrentStaffId(),
    getCurrentUser(),
  ]);

  if (!staffId || !user) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <Header />
        <p className="text-sm text-muted-foreground">
          Your account isn't linked to a staff profile yet, so there's no
          timesheet to show. Contact an admin to get set up.
        </p>
      </div>
    );
  }

  const rows = await getTimesheetList(staffId);

  // This is the viewer's own list, so ownership is a given — a week is editable
  // when it's inside the ±1-week window, or the viewer holds the capability.
  const hasEditAll = userHasPermission(user, { timesheets: ["edit"] });
  const canEdit = (week: string) => hasEditAll || isWithinEditWindow(week);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <Header />
      <TimesheetsList rows={rows} canEdit={canEdit} />
    </div>
  );
}
