import type { InferSelectModel } from "drizzle-orm";
import {
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { companies } from "./crm-schema";
import { lineOfBusinessEnum, staff } from "./staff-schema";

// ---------------------------------------------------------------------------
// Projects domain
//
// A `project` is billable work for a company — the hub linking CRM to delivery.
// `project_delivery_managers` is a junction to the staff who run the project.
// `project_roles` are the staffing lines: a person on a line of business for a
// date range at N hours/day (the first cut of the proposed Allocation entity).
// See docs/data-model.md and docs/domains/projects.md.
// ---------------------------------------------------------------------------

export const projects = pgTable("projects", {
  id: text().primaryKey(),
  name: text().notNull(),
  // A project always belongs to a company. `restrict`: a company with live
  // projects can't be deleted (mirrors opportunities).
  companyId: text()
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),

  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// Delivery managers: many staff per project. Junction table following the CRM
// convention — surrogate `text` PK, a unique on the FK pair for set-semantics,
// an index on the staff FK for reverse lookups, both FKs cascade.
export const projectDeliveryManagers = pgTable(
  "project_delivery_managers",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    staffId: text()
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (t) => [
    unique("project_delivery_managers_unique").on(t.projectId, t.staffId),
    index("project_delivery_managers_staff_idx").on(t.staffId),
  ],
);

// Roles: a staffing line on a project. Not a pure junction — it carries the
// line of business, date range, and daily hours. `staffId` is `restrict` (a
// role without its person is meaningless; deleting staff with live roles is
// blocked), while `projectId` cascades with its parent project.
export const projectRoles = pgTable(
  "project_roles",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    staffId: text()
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),
    lineOfBusiness: lineOfBusinessEnum().notNull(),
    startDate: date().notNull(),
    endDate: date().notNull(),
    // Daily hours for this role; allows half-days (e.g. 7.5). Defaults to 8.
    hoursPerDay: numeric({ precision: 4, scale: 2, mode: "number" })
      .notNull()
      .default(8),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (t) => [
    index("project_roles_project_idx").on(t.projectId),
    index("project_roles_staff_idx").on(t.staffId),
  ],
);

// --- Row types -------------------------------------------------------------

export type Project = InferSelectModel<typeof projects>;
export type ProjectDeliveryManager = InferSelectModel<
  typeof projectDeliveryManagers
>;
export type ProjectRole = InferSelectModel<typeof projectRoles>;
