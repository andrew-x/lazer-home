"use server";

import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { timesheets } from "@/lib/db/schema";
import { authorizeTimesheetEdit } from "./canEditTimesheet";
import { timesheetWeekSchema } from "./timesheetWeek.schema";

/**
 * Submit a week — flip it `draft → submitted` and stamp `submittedAt`, locking it
 * from further edits until reopened. No manager approval step in v1. Creates the
 * row lazily so an empty week can be submitted; the client normally calls
 * `saveTimesheet` first. Gated by `authorizeTimesheetEdit`.
 */
export const submitTimesheet = secureActionClient
  .metadata({ action: "submit-timesheet", authorize: authorizeTimesheetEdit })
  .inputSchema(timesheetWeekSchema)
  .action(async ({ parsedInput }) => {
    const { staffId, weekStartDate } = parsedInput;

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
