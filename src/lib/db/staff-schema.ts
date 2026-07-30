import { type InferSelectModel, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { LINE_OF_BUSINESS } from "@/lib/crm/line-of-business";
import { CURRENCY } from "@/lib/format/currency";
import type { StaffSkill } from "@/lib/staff/skills";
import { BONUS_TYPES } from "@/lib/staff/staff-bonus";
import { user } from "./auth-schema";

// ---------------------------------------------------------------------------
// Staff profiles domain
//
// `staff` is the durable record of an engagement; `staffEmployment` captures
// the time-varying employment facts (role, line of business, billability,
// target). A new employment row is created whenever those facts change, keyed
// by `effectiveFromDate` — the current state is the row with the latest date.
// `staffPto` records discrete leave spans, and `staffBonusPayment` discrete bonus
// payments — both dated events rather than effective-dated state. See ADR 0007.
// ---------------------------------------------------------------------------

// --- Enums -----------------------------------------------------------------

// Shared/global enum — reused beyond staff (e.g. CRM, projects/allocations).
// Values live in `@/lib/crm/line-of-business` (a pure module) so the pgEnum here and
// the zod enum / form labels there share one source of truth.
export const lineOfBusinessEnum = pgEnum("line_of_business", [
  ...LINE_OF_BUSINESS,
]);

export const roleEnum = pgEnum("role", [
  "ENGINEER",
  "DESIGNER",
  "LEADERSHIP",
  "SALES",
  "SOLUTIONS",
  "OPERATIONS",
  "ARCHITECT",
  "DELIVERY",
  "QA",
]);

export const employmentTypeEnum = pgEnum("employment_type", [
  "FULL_TIME",
  "HOURLY",
]);

export const billableTypeEnum = pgEnum("billable_type", ["HUB", "GLOBAL"]);

// Compensation currency. Values live in `@/lib/format/currency` (a pure module) so this
// pgEnum, the import's zod enum, and display formatting share one source of truth.
export const currencyEnum = pgEnum("currency", [...CURRENCY]);

// Why a bonus was paid. Values live in `@/lib/staff/staff-bonus` (a pure module)
// so this pgEnum, the client form's zod enum, and the dashboard labels share one
// source of truth. `DISCRETIONARY` (decided in a review cycle) and `SPOT`
// (ad-hoc) are deliberately distinct — see that module.
export const staffBonusTypeEnum = pgEnum("staff_bonus_type", [...BONUS_TYPES]);

export const ptoTypeEnum = pgEnum("pto_type", [
  "VACATION",
  "STATUTORY_HOLIDAY",
  "SICK_LEAVE",
  "UNPAID_LEAVE",
  "PARENTAL_LEAVE",
  "BEREAVEMENT_LEAVE",
  "COMPANY_RETREAT",
  "RELIGIOUS_HOLIDAY",
  "JURY_DUTY",
  "LEAVE_OF_ABSENCE",
  "OTHER_LEAVE",
]);

// --- Tables ----------------------------------------------------------------

export const staff = pgTable("staff", {
  id: text().primaryKey(),
  ripplingId: text().notNull().unique(),
  // Optional link to the auth account. Null until the person signs in (staff
  // can be synced before they ever log in); unique → at most one staff per user.
  userId: text()
    .unique()
    .references(() => user.id, { onDelete: "set null" }),
  name: text().notNull(),
  email: text().notNull(),

  // Who this person reports to (optional, at most one). Self-reference, so it
  // needs the `AnyPgColumn` annotation. `set null` mirrors `contacts.managerId`:
  // removing a manager clears their reports' pointers rather than blocking.
  // Populated exclusively by the CSV import (matched via `Manager - Work email`);
  // there is no in-app editor. See docs/domains/staff-profiles.md.
  managerId: text().references((): AnyPgColumn => staff.id, {
    onDelete: "set null",
  }),

  linkedinUrl: text(),
  githubUrl: text(),
  portfolioUrl: text(),

  // Optional home base as a free-text "City, CC" label (e.g. "Toronto, CA"),
  // picked from the static world-cities list (`@/lib/cities`). Free text, not a
  // FK/enum — see docs/data-model.md. Null when unknown. No in-app editor yet.
  location: text(),

  clientIntro: text(),
  clientIntroUpdatedAt: timestamp(),

  // Free-text resume. Typed in or extracted from an uploaded PDF (we store text
  // only, never the file). `resumeUpdatedAt` is stamped explicitly by the update
  // action when the text changes — NOT $onUpdate, which would fire on every row
  // write (e.g. an import re-sync).
  resume: text(),
  resumeUpdatedAt: timestamp(),

  // Free-text staffing/planning note surfaced only in the Allocations planner
  // (e.g. "on bench after Aug 15, wants frontend work"). Manager/admin-only
  // (`staff.edit`) — see docs/domains/allocations.md. Nullable, no default.
  allocationNotes: text(),

  // Skills held, as an inline list of { name, level } picked from the hardcoded
  // catalogue in `@/lib/staff/skills` (deliberately not a normalized skills table).
  skills: jsonb().$type<StaffSkill[]>().notNull().default([]),

  joinDate: date(),
  terminationDate: date(),
  isActive: boolean().notNull().default(true),

  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const staffEmployment = pgTable("staff_employment", {
  id: text().primaryKey(),
  staffId: text()
    .notNull()
    .references(() => staff.id, { onDelete: "cascade" }),
  effectiveFromDate: date().notNull(),

  lineOfBusiness: lineOfBusinessEnum().notNull(),
  role: roleEnum().notNull(),
  employmentType: employmentTypeEnum().notNull(),
  isBillable: boolean().notNull().default(true),
  // Percentage (0–100). Defaults to 100 for billable staff; callers should set
  // it to 0 when `isBillable` is false.
  utilizationTarget: integer().notNull().default(100),

  billableType: billableTypeEnum().notNull().default("HUB"),

  // Orthogonal to `role`: someone can work in a role (e.g. ENGINEER) and also be
  // management for it. Set in-app (never derived from the CSV import), so import
  // preserves it across re-syncs rather than resetting it. See ADR 0007.
  isManagement: boolean().notNull().default(false),

  // Compensation facts. Required for staff going forward. Effective-dated like the
  // rest of this table: a comp change spawns a new row. Populated by the CSV import
  // only; carried forward (never wiped) whenever a non-comp change spawns a new row.
  //
  // Only ONGOING terms belong here. One-off bonuses deliberately do NOT: they are
  // dated payments, not terms of employment, and live in `staffBonusPayment`. (A
  // `discretionaryBonus` column used to sit here and was wrong for exactly that
  // reason — it read as part of go-forward pay and had room for only one payment.)
  base: numeric({ precision: 12, scale: 2, mode: "number" }).notNull(),
  hourlyRate: numeric({ precision: 12, scale: 2, mode: "number" }).notNull(),
  guaranteedBonus: numeric({
    precision: 12,
    scale: 2,
    mode: "number",
  }).notNull(),
  currency: currencyEnum().notNull(),

  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

/**
 * A bonus paid to a staff member on a date.
 *
 * Sibling to `staffPto`, and the same kind of thing: a discrete dated event about
 * a person, destined to be sourced from Rippling. Explicitly NOT effective-dated
 * and never superseded — a payment either happened or it didn't, so there is one
 * date (`paymentDate`) and no history chain.
 *
 * Deliberately carries NO `lineOfBusiness`/`role` and no FK to `staffEmployment`:
 * the dashboard derives those from the employment row effective on `paymentDate`
 * (`employmentAsOf`), so a February bonus keeps counting under the discipline the
 * person held in February even after they move. Snapshotting them here would
 * freeze a guess taken at entry time instead.
 */
export const staffBonusPayment = pgTable(
  "staff_bonus_payment",
  {
    id: text().primaryKey(),
    // Cascade mirrors `staffPto`: a payment is meaningless without the person.
    staffId: text()
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),

    // The point in time, and the only date this table has.
    paymentDate: date().notNull(),

    // No default: recording a payment means knowing why it was paid. Values and
    // their meanings live in `@/lib/staff/staff-bonus`.
    type: staffBonusTypeEnum().notNull(),

    // For a non-cash type (`GIFT`) this is the cash-equivalent value, not money
    // that left an account.
    amount: numeric({ precision: 12, scale: 2, mode: "number" }).notNull(),
    // Stored per payment rather than read off the person: a bonus can be paid in
    // a currency other than the one they're salaried in.
    currency: currencyEnum().notNull(),

    // Anything the type doesn't capture — which milestone, who was referred,
    // what the gift was.
    notes: text(),

    // Rippling's payment id, reserved for the importer that will eventually own
    // this table. Nullable while rows are entered by hand; unique so a re-import
    // is idempotent rather than duplicating a payment.
    ripplingId: text().unique(),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("staff_bonus_payment_staff_idx").on(t.staffId),
    // The dashboard reads a calendar year at a time.
    index("staff_bonus_payment_date_idx").on(t.paymentDate),
    // A zero or negative bonus isn't a payment. Guarded in the DB as well as the
    // zod schema, because the importer will write here without the form.
    check("staff_bonus_payment_amount_positive", sql`${t.amount} > 0`),
  ],
);

export const staffPto = pgTable("staff_pto", {
  id: text().primaryKey(),
  ripplingId: text().notNull().unique(),
  staffId: text()
    .notNull()
    .references(() => staff.id, { onDelete: "cascade" }),

  startDate: date().notNull(),
  endDate: date().notNull(),
  type: ptoTypeEnum().notNull(),

  // Awaiting approval; cleared once the request is approved (or synced as
  // already-approved from Rippling).
  isPending: boolean().notNull().default(true),

  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// --- Row types -------------------------------------------------------------

export type Staff = InferSelectModel<typeof staff>;
export type StaffEmployment = InferSelectModel<typeof staffEmployment>;
export type StaffBonusPayment = InferSelectModel<typeof staffBonusPayment>;
export type StaffPto = InferSelectModel<typeof staffPto>;
