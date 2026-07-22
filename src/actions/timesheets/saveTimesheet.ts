"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { userHasPermission } from "@/lib/auth/permissions";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { timeEntries, timesheets } from "@/lib/db/schema";
import { authorizeTimesheetEdit } from "./canEditTimesheet";
import { saveTimesheetSchema } from "./saveTimesheet.schema";

/**
 * Save a week's timesheet (draft). Creates the `timesheets` row lazily on first
 * save, then does a transactional whole-week replace of its `time_entries` — the
 * simplest correct model for a grid edited a week at a time. Zero-hour rows are
 * dropped. Gated by `authorizeTimesheetEdit` (own + within the ±1-week window, or
 * the `timesheets.edit` capability). Validation (8h/day cap, one-target-per-row,
 * dates within the week) lives in `saveTimesheetSchema`, shared with the form.
 *
 * A submitted week is locked: a normal owner must `reopenTimesheet` first; only
 * the `timesheets.edit` capability can overwrite a submitted week in place.
 */
export const saveTimesheet = secureActionClient
  .metadata({ action: "save-timesheet", authorize: authorizeTimesheetEdit })
  .inputSchema(saveTimesheetSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { staffId, weekStartDate, entries } = parsedInput;
    const rows = entries.filter((e) => e.hours > 0);

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: timesheets.id, status: timesheets.status })
        .from(timesheets)
        .where(
          and(
            eq(timesheets.staffId, staffId),
            eq(timesheets.weekStartDate, weekStartDate),
          ),
        )
        .limit(1);

      let timesheetId: string;
      if (existing) {
        if (
          existing.status === "submitted" &&
          !userHasPermission(ctx.user, { timesheets: ["edit"] })
        ) {
          throw new UserSafeActionError(
            "This week has been submitted. Reopen it before editing.",
          );
        }
        timesheetId = existing.id;
      } else {
        timesheetId = generateId("ts");
        await tx
          .insert(timesheets)
          .values({ id: timesheetId, staffId, weekStartDate });
      }

      // Whole-week replace.
      await tx
        .delete(timeEntries)
        .where(eq(timeEntries.timesheetId, timesheetId));
      if (rows.length > 0) {
        await tx.insert(timeEntries).values(
          rows.map((e) => ({
            id: generateId("te"),
            timesheetId,
            date: e.date,
            projectId: e.projectId ?? null,
            category: e.category ?? null,
            hours: e.hours,
          })),
        );
      }
    });

    revalidatePath("/timesheets");
    return { ok: true };
  });
