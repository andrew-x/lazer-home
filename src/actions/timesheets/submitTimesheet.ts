"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getEmploymentTypeAsOf } from "@/actions/staff/getEmploymentTypeAsOf";
import {
  requiresFullWeek,
  WEEKLY_HOUR_CAP,
} from "@/actions/timesheets/saveTimesheet.schema";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { timeEntries, timesheets } from "@/lib/db/schema";
import { getWeekDays } from "@/lib/timesheets/timesheet-week";
import { authorizeTimesheetEdit } from "./canEditTimesheet";
import { timesheetWeekSchema } from "./timesheetWeek.schema";

/** Hours logged across the week, 0 when the sheet doesn't exist yet. */
async function weekTotalHours(
  staffId: string,
  weekStartDate: string,
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${timeEntries.hours}), 0)`.mapWith(
        Number,
      ),
    })
    .from(timesheets)
    .leftJoin(timeEntries, eq(timeEntries.timesheetId, timesheets.id))
    .where(
      and(
        eq(timesheets.staffId, staffId),
        eq(timesheets.weekStartDate, weekStartDate),
      ),
    );

  return row?.total ?? 0;
}

/**
 * Submit a week — flip it `draft → submitted` and stamp `submittedAt`, locking it
 * from further edits until reopened. No manager approval step in v1. Creates the
 * row lazily so an empty week can be submitted; the client normally calls
 * `saveTimesheet` first. Gated by `authorizeTimesheetEdit`.
 *
 * Full-time staff must account for a full `WEEKLY_HOUR_CAP` week first — the
 * grid disables Submit below that, and this is the boundary that enforces it.
 * Saving a short draft stays allowed, and hourly staff are exempt.
 */
export const submitTimesheet = secureActionClient
  .metadata({ action: "submit-timesheet", authorize: authorizeTimesheetEdit })
  .inputSchema(timesheetWeekSchema)
  .action(async ({ parsedInput }) => {
    const { staffId, weekStartDate } = parsedInput;

    const weekDays = getWeekDays(weekStartDate);
    const employmentType = await getEmploymentTypeAsOf(staffId, weekDays[6]);
    if (requiresFullWeek(employmentType)) {
      const total = await weekTotalHours(staffId, weekStartDate);
      if (total < WEEKLY_HOUR_CAP) {
        throw new UserSafeActionError(
          `This week only accounts for ${total} of ${WEEKLY_HOUR_CAP} hours. Log the remaining time against a project, a non-billable category, or PTO before submitting.`,
        );
      }
    }

    await db
      .insert(timesheets)
      .values({
        id: generateId("ts"),
        staffId,
        weekStartDate,
        status: "submitted",
        submittedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [timesheets.staffId, timesheets.weekStartDate],
        set: { status: "submitted", submittedAt: new Date() },
      });

    revalidatePath("/timesheets");
    return { ok: true };
  });
