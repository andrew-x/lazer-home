import type { InferInsertModel } from "drizzle-orm";
import { generateId } from "@/lib/db/ids";
import {
  type Project,
  type Staff,
  timeEntries,
  timesheets,
} from "@/lib/db/schema";
import { TIMESHEET_CATEGORY } from "@/lib/timesheets/timesheet-category";
import {
  addWeeks,
  currentWeekStart,
  getWeekDays,
  isWeekend,
} from "@/lib/timesheets/timesheet-week";
import type { SeedDb } from "./client";
import { chance, faker } from "./faker";

const STAFF_WITH_TIMESHEETS = 15;
const WEEKS_BACK = 4;

type TimesheetInsert = InferInsertModel<typeof timesheets>;
type TimeEntryInsert = InferInsertModel<typeof timeEntries>;

/**
 * Seed a few recent weeks of timesheets for a subset of staff. Each weekday gets
 * 8 hours split across a project (billable) and/or a non-billable category, each
 * entry targeting exactly one of the two (the `time_entries_target_check` XOR).
 */
export async function seedTimesheets(
  db: SeedDb,
  staff: Staff[],
  projects: Project[],
): Promise<{ timesheets: number; entries: number }> {
  const active = staff.filter((s) => s.isActive);
  const people = faker.helpers.arrayElements(
    active,
    Math.min(STAFF_WITH_TIMESHEETS, active.length),
  );
  const thisWeek = currentWeekStart();

  const sheetRows: TimesheetInsert[] = [];
  const entryRows: TimeEntryInsert[] = [];

  for (const person of people) {
    for (let w = 0; w < WEEKS_BACK; w++) {
      const weekStart = addWeeks(thisWeek, -w);
      // The current week is still in progress → left as a draft.
      const submitted = w > 0 && chance(0.8);
      const timesheetId = generateId("ts");
      sheetRows.push({
        id: timesheetId,
        staffId: person.id,
        weekStartDate: weekStart,
        status: submitted ? "submitted" : "draft",
        submittedAt: submitted ? faker.date.recent({ days: 7 + w * 7 }) : null,
      });

      for (const day of getWeekDays(weekStart)) {
        if (isWeekend(day)) continue;
        // Either a full billable day, or a split with a non-billable bucket.
        if (projects.length > 0 && chance(0.75)) {
          const billed = faker.helpers.arrayElement([8, 6, 4]);
          entryRows.push({
            id: generateId("te"),
            timesheetId,
            date: day,
            projectId: faker.helpers.arrayElement(projects).id,
            category: null,
            hours: billed,
          });
          if (billed < 8) {
            entryRows.push({
              id: generateId("te"),
              timesheetId,
              date: day,
              projectId: null,
              category: faker.helpers.arrayElement(TIMESHEET_CATEGORY),
              hours: 8 - billed,
            });
          }
        } else {
          entryRows.push({
            id: generateId("te"),
            timesheetId,
            date: day,
            projectId: null,
            category: faker.helpers.arrayElement(TIMESHEET_CATEGORY),
            hours: 8,
          });
        }
      }
    }
  }

  await db.insert(timesheets).values(sheetRows);
  if (entryRows.length > 0) await db.insert(timeEntries).values(entryRows);

  return { timesheets: sheetRows.length, entries: entryRows.length };
}
