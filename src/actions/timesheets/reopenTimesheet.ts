"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { timesheets } from "@/lib/db/schema";
import { authorizeTimesheetEdit } from "./canEditTimesheet";
import { timesheetWeekSchema } from "./timesheetWeek.schema";

/**
 * Reopen a submitted week — flip it back to `draft` and clear `submittedAt` so
 * the owner can edit it again (within the window; admins any). A no-op if no
 * timesheet row exists yet. Gated by `authorizeTimesheetEdit`.
 */
export const reopenTimesheet = secureActionClient
  .metadata({ action: "reopen-timesheet", authorize: authorizeTimesheetEdit })
  .inputSchema(timesheetWeekSchema)
  .action(async ({ parsedInput }) => {
    const { staffId, weekStartDate } = parsedInput;

    await db
      .update(timesheets)
      .set({ status: "draft", submittedAt: null })
      .where(
        and(
          eq(timesheets.staffId, staffId),
          eq(timesheets.weekStartDate, weekStartDate),
        ),
      );

    revalidatePath("/timesheets");
    return { ok: true };
  });
