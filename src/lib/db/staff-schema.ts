import type { InferSelectModel } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
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
import { user } from "./auth-schema";

// ---------------------------------------------------------------------------
// Staff profiles domain
//
// `staff` is the durable record of an engagement; `staffEmployment` captures
// the time-varying employment facts (role, line of business, billability,
// target). A new employment row is created whenever those facts change, keyed
// by `effectiveFromDate` — the current state is the row with the latest date.
// `staffPto` records discrete leave spans. See ADR 0007.
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
  // `discretionaryBonus` isn't imported yet, so it defaults to 0.
  base: numeric({ precision: 12, scale: 2, mode: "number" }).notNull(),
  hourlyRate: numeric({ precision: 12, scale: 2, mode: "number" }).notNull(),
  guaranteedBonus: numeric({
    precision: 12,
    scale: 2,
    mode: "number",
  }).notNull(),
  discretionaryBonus: numeric({ precision: 12, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  currency: currencyEnum().notNull(),

  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

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
export type StaffPto = InferSelectModel<typeof staffPto>;
