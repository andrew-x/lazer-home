import { z } from "zod";
import { dateString } from "@/lib/schemas/date-schema";
import { id } from "@/lib/schemas/id-schema";

/**
 * Identifies one person's timesheet week — the input shared by the `submit` and
 * `reopen` actions (and the shape the `authorizeTimesheetEdit` hook reads). Its
 * own file so client components can import it for their action calls without
 * pulling in a "use server" module.
 */
export const timesheetWeekSchema = z.object({
  staffId: id,
  weekStartDate: dateString,
});

export type TimesheetWeekInput = z.input<typeof timesheetWeekSchema>;
