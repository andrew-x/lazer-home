import { type InferSelectModel, sql } from "drizzle-orm";
import {
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { PROJECT_ROLE_TYPES } from "@/lib/project-role-type";
import { DEFAULT_PROJECT_STATUS, PROJECT_STATUSES } from "@/lib/project-status";
import { companies } from "./crm-schema";
import { opportunities } from "./opportunities-schema";
import { lineOfBusinessEnum, staff } from "./staff-schema";

// ---------------------------------------------------------------------------
// Projects domain
//
// A `project` is billable work for a company — the hub linking CRM to delivery.
// It carries a line of business (defaulted from its originating opportunity).
// `project_delivery_managers` is a junction to the staff who run the project.
// `project_roles` are the staffing lines: a person for a date range at N
// hours/day (the first cut of the proposed Allocation entity).
// See docs/data-model.md and docs/domains/projects.md.
// ---------------------------------------------------------------------------

// Lifecycle status values — built from the shared, client-safe module so the
// pgEnum, zod, and form labels can't drift.
export const projectStatusEnum = pgEnum("project_status", [
  ...PROJECT_STATUSES,
]);

export const projects = pgTable(
  "projects",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    // Where the project sits in its lifecycle. New projects default to
    // `tentative`; the shared enum is the single source of truth.
    status: projectStatusEnum().notNull().default(DEFAULT_PROJECT_STATUS),
    // A project always belongs to a company. `restrict`: a company with live
    // projects can't be deleted (mirrors opportunities).
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // The line of business this project belongs to. Defaults to the originating
    // opportunity's line of business when created from one (see createProject).
    // Shared/global enum (see `lineOfBusinessEnum`).
    lineOfBusiness: lineOfBusinessEnum().notNull(),
    // A project may originate from a CRM opportunity — optional, so a project
    // can also be created standalone. `restrict`: an opportunity with a live
    // project can't be deleted (mirrors companyId). An opportunity has at most
    // one project; a project relates to at most one opportunity.
    opportunityId: text().references(() => opportunities.id, {
      onDelete: "restrict",
    }),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // At most one project per opportunity. Partial, because the column is
    // nullable — standalone projects (null opportunityId) aren't constrained and
    // can coexist. Also serves as the lookup index on the FK. The predicate uses
    // the bare column name: Postgres rejects a table-qualified reference in a
    // CREATE INDEX WHERE clause.
    uniqueIndex("projects_opportunity_idx")
      .on(t.opportunityId)
      .where(sql`"opportunity_id" is not null`),
  ],
);

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

// Role type (discipline) values — built from the shared, client-safe module so
// the pgEnum, zod, and form labels can't drift.
export const projectRoleTypeEnum = pgEnum("project_role_type", [
  ...PROJECT_ROLE_TYPES,
]);

// Roles: a staffing line on a project. Not a pure junction — it carries the
// role type (discipline), date range, and daily hours. A role may be a
// *placeholder* (an open position defined before it's staffed), so `staffId` is
// nullable; when set, it's `restrict` (a staffed role blocks deleting its
// person). `projectId` cascades with its parent project. Line of business lives
// on the project, not the role.
export const projectRoles = pgTable(
  "project_roles",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Null for a placeholder/open position; set once the role is staffed.
    staffId: text().references(() => staff.id, { onDelete: "restrict" }),
    // Optional label for the line, e.g. "Senior Backend Engineer".
    name: text(),
    roleType: projectRoleTypeEnum().notNull(),
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
