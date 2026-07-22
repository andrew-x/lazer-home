import type { InferSelectModel } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { TIMESHEET_CATEGORY } from "@/lib/timesheets/timesheet-category";
import { TIMESHEET_STATUSES } from "@/lib/timesheets/timesheet-status";
import { projects } from "./projects-schema";
import { staff } from "./staff-schema";

// ---------------------------------------------------------------------------
// Timesheets domain
//
// Weekly time capture — the *actuals* that complement the allocation plan. A
// `timesheet` is one person's week (keyed by its ISO-Monday `weekStartDate`),
// with a draft→submitted lifecycle. `time_entries` are the per-day rows: hours
// logged against either a project (billable) or a non-billable bucket. Editing
// happens a whole week at a time. See docs/domains/timesheets.md.
// ---------------------------------------------------------------------------

// --- Enums -----------------------------------------------------------------

// Draft→submitted lifecycle. Values live in `@/lib/timesheets/timesheet-status` (a pure
// module) so this pgEnum, the read types, and the UI labels share one source of
// truth.
export const timesheetStatusEnum = pgEnum("timesheet_status", [
  ...TIMESHEET_STATUSES,
]);

// Non-billable buckets. Values live in `@/lib/timesheets/timesheet-category` (a pure module)
// so this pgEnum, the zod schemas, and the form labels share one source of truth.
export const timeEntryCategoryEnum = pgEnum("time_entry_category", [
  ...TIMESHEET_CATEGORY,
]);

// --- Tables ----------------------------------------------------------------

export const timesheets = pgTable(
  "timesheets",
  {
    id: text().primaryKey(),
    staffId: text()
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    // ISO Monday of the week this timesheet covers.
    weekStartDate: date().notNull(),
    status: timesheetStatusEnum().notNull().default("draft"),
    // Stamped when the week is submitted; cleared on reopen.
    submittedAt: timestamp(),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // One timesheet per person per week.
    unique("timesheets_staff_week_unique").on(t.staffId, t.weekStartDate),
    index("timesheets_staff_idx").on(t.staffId),
  ],
);

export const timeEntries = pgTable(
  "time_entries",
  {
    id: text().primaryKey(),
    timesheetId: text()
      .notNull()
      .references(() => timesheets.id, { onDelete: "cascade" }),
    // The day the hours were worked (one of the parent week's 7 days).
    date: date().notNull(),
    // A row targets EITHER a project (billable) OR a category (non-billable) —
    // exactly one is set (enforced by the check constraint below and the action).
    // `restrict`: a project with logged time can't be deleted.
    projectId: text().references(() => projects.id, { onDelete: "restrict" }),
    category: timeEntryCategoryEnum(),
    // Hours worked that day on this target. Allows quarter/half hours (e.g. 7.5).
    hours: numeric({ precision: 4, scale: 2, mode: "number" }).notNull(),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("time_entries_timesheet_idx").on(t.timesheetId),
    // Exactly one of projectId / category must be set (XOR on IS NOT NULL).
    check(
      "time_entries_target_check",
      sql`(${t.projectId} is not null) <> (${t.category} is not null)`,
    ),
  ],
);

// --- Row types -------------------------------------------------------------

export type Timesheet = InferSelectModel<typeof timesheets>;
