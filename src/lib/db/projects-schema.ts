import type { InferSelectModel } from "drizzle-orm";
import {
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import {
  DEFAULT_PROJECT_ROLE_STATUS,
  PROJECT_ROLE_STATUSES,
} from "@/lib/projects/project-role-status";
import { PROJECT_ROLE_TYPES } from "@/lib/projects/project-role-type";
import { companies } from "./crm-schema";
import { opportunities } from "./opportunities-schema";
import { lineOfBusinessEnum, staff } from "./staff-schema";

// ---------------------------------------------------------------------------
// Projects domain
//
// A `project` is billable work for a company — the hub linking CRM to delivery.
// A project has NO status or line of business of its own: both are *derived*
// from its roles (see `project-derived.ts`) — a project's status aggregates its
// roles' statuses, and its lines of business are the distinct LoBs of its roles.
// `project_delivery_managers` is a junction to the staff who run the project.
// `project_roles` are the staffing lines: a person for a date range at N
// hours/day (the first cut of the proposed Allocation entity).
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
  // The CRM → delivery link now lives on `opportunities.projectId` (many
  // opportunities can build up one project). See docs/decisions/0019 and 0024.

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

// Role type (discipline) values — built from the shared, client-safe module so
// the pgEnum, zod, and form labels can't drift.
export const projectRoleTypeEnum = pgEnum("project_role_type", [
  ...PROJECT_ROLE_TYPES,
]);

// Role planning status — `tentative` while planned against an opportunity,
// `confirmed` once that opportunity is won, `paused`/`cancelled` when on hold or
// dropped. The project's derived status aggregates these. Built from the shared
// client-safe module so the pgEnum, zod, and labels can't drift.
export const projectRoleStatusEnum = pgEnum("project_role_status", [
  ...PROJECT_ROLE_STATUSES,
]);

// Roles: a staffing line on a project. Not a pure junction — it carries the
// role type (discipline), date range, and daily hours. A role may be a
// *placeholder* (an open position defined before it's staffed), so `staffId` is
// nullable; when set, it's `restrict` (a staffed role blocks deleting its
// person). `projectId` cascades with its parent project. Line of business lives
// on the role (a project's LoBs are derived from its roles); a role created from
// an opportunity inherits that opportunity's line of business by default.
export const projectRoles = pgTable(
  "project_roles",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Null for a placeholder/open position; set once the role is staffed.
    staffId: text().references(() => staff.id, { onDelete: "restrict" }),
    // The opportunity that created this role (which deal/extension staffed it),
    // used to scope who may edit it and to grey out roles from other
    // opportunities in that opportunity's planner. Nullable: a role added to a
    // standalone project has no opportunity. `set null`: deleting the
    // opportunity keeps the role (its `projectId` still holds it).
    opportunityId: text().references(() => opportunities.id, {
      onDelete: "set null",
    }),
    // `tentative` while planned; flips to `confirmed` when the opportunity is
    // won. A confirmed role is locked (read-only) in the planner.
    status: projectRoleStatusEnum()
      .notNull()
      .default(DEFAULT_PROJECT_ROLE_STATUS),
    // The line of business this role belongs to. A project's set of lines of
    // business is derived from its roles. Defaults from the originating
    // opportunity when created from one. Shared/global enum.
    lineOfBusiness: lineOfBusinessEnum().notNull(),
    // Optional free-text description of the line, e.g. "Senior Backend Engineer".
    description: text(),
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
    index("project_roles_opportunity_idx").on(t.opportunityId),
  ],
);

// --- Row types -------------------------------------------------------------

export type Project = InferSelectModel<typeof projects>;
export type ProjectRole = InferSelectModel<typeof projectRoles>;
