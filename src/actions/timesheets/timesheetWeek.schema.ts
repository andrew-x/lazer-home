import { z } from "zod";

/**
 * Identifies one person's timesheet week — the input shared by the `submit` and
 * `reopen` actions (and the shape the `authorizeTimesheetEdit` hook reads). Its
 * own file so client components can import it for their action calls without
 * pulling in a "use server" module.
 */
export const timesheetWeekSchema = z.object({
  staffId: z.string().min(1),
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date."),
});

export type TimesheetWeekInput = z.input<typeof timesheetWeekSchema>;
