import { type InferSelectModel, sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { BILLING_TYPES } from "@/lib/projects/project-billing";
import {
  PROJECT_HEALTH_MAX,
  PROJECT_HEALTH_MIN,
} from "@/lib/projects/project-health";
import {
  DEFAULT_PROJECT_ROLE_STATUS,
  PROJECT_ROLE_STATUSES,
} from "@/lib/projects/project-role-status";
import { PROJECT_ROLE_TYPES } from "@/lib/projects/project-role-type";
import { companies } from "./crm-schema";
import { opportunities } from "./opportunities-schema";
import { currencyEnum, lineOfBusinessEnum, staff } from "./staff-schema";

// ---------------------------------------------------------------------------
// Projects domain
//
// A `project` is billable work for a company — the hub linking CRM to delivery.
// A project has NO status, line of business or delivery manager of its own: all
// three are *derived* from its roles — its status aggregates its roles' statuses
// and its lines of business are their distinct LoBs (`project-derived.ts`), while
// its delivery managers are the people on its `DELIVERY` roles
// (`delivery-coverage.ts`). There used to be a `project_delivery_managers`
// junction; it carried no dates, so it could never say who ran the project *in
// March*, and a delivery manager is now an ordinary role like any other (ADR 0068).
// `project_roles` are the staffing lines: a person for a date range at N
// hours/day (the first cut of the proposed Allocation entity).
// Each role carries its own `billRate`, snapshotted from the code-owned rate card
// (`@/lib/projects/bill-rates`) when it's created and editable thereafter — so a
// project's revenue is reproducible from its own rows and a card revision prices
// only future roles (ADR 0066).
// See docs/data-model.md and docs/domains/projects.md.
// ---------------------------------------------------------------------------

// How a project bills — one total fee, or hourly rates per role type. Built from
// the shared client-safe module so the pgEnum, zod, and form labels can't drift.
export const projectBillingTypeEnum = pgEnum("project_billing_type", [
  ...BILLING_TYPES,
]);

export const projects = pgTable(
  "projects",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    // A project always belongs to a company. `restrict`: a company with live
    // projects can't be deleted (mirrors opportunities).
    companyId: text()
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    // The CRM → delivery link now lives on `opportunities.projectId` (many
    // opportunities can build up one project). See docs/decisions/0019 and 0024.

    // --- Billing / budget --------------------------------------------------
    // How this project bills. NULLABLE with no default, and that null is
    // *meaningful*: every project created before budgets existed genuinely has no
    // budget, and the UI reads it as "No budget set" rather than inventing a zero
    // (the same "no target ≠ a target of nothing" rule as `compTargetAnnual`).
    // The create form requires it going forward.
    billingType: projectBillingTypeEnum(),
    // The total fee, for FIXED_FEE only. A time-and-materials project has no
    // total — it bills each role's hours at that role's own `billRate` — so both
    // of these stay null there, and the check constraint below makes the
    // mismatched combinations unrepresentable rather than merely discouraged.
    budgetAmount: numeric({ precision: 12, scale: 2, mode: "number" }),
    budgetCurrency: currencyEnum(),

    // --- Slack ------------------------------------------------------------
    // The PUBLIC delivery channel for this project (`l-project-<slug>`), the
    // mirror of `opportunities.scopingSlackChannelId`. Managed only from this
    // project's own detail page — the opportunity drawer deliberately does not
    // reach across to it, since a project built from several opportunities would
    // have no unambiguous owner for the control. See docs/decisions/0067.
    slackChannelId: text(),
    // A display-only SNAPSHOT of the name; see the note on the opportunity pair.
    slackChannelName: text(),

    // --- Google Drive -----------------------------------------------------
    // The delivery folder for this project, at `Lazer Home/Projects/<name>`, the
    // mirror of `opportunities.salesDriveFolderId`. Managed only from this
    // project's own surface. See docs/decisions/0069.
    driveFolderId: text(),
    // A display-only SNAPSHOT of the name; see the note on the opportunity pair.
    driveFolderName: text(),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // The billing shape as a DB invariant, so a half-written budget can't exist:
    // no budget at all, or a FIXED_FEE carrying both an amount and its currency,
    // or a TIME_AND_MATERIALS carrying neither. Mirrors the zod discriminated
    // union in `projectBudget.schema.ts` — one rule, enforced at both ends. Every
    // pre-budget row satisfies the first branch, so this needed no backfill.
    check(
      "projects_budget_shape",
      sql`(${t.billingType} is null and ${t.budgetAmount} is null and ${t.budgetCurrency} is null)
       or (${t.billingType} = 'FIXED_FEE' and ${t.budgetAmount} is not null and ${t.budgetCurrency} is not null)
       or (${t.billingType} = 'TIME_AND_MATERIALS' and ${t.budgetAmount} is null and ${t.budgetCurrency} is null)`,
    ),
    // One Slack channel is linked to at most one project — the mirror of
    // `opportunities_scoping_slack_channel_idx`, and the same NULLs-are-distinct
    // reasoning applies.
    uniqueIndex("projects_slack_channel_idx").on(t.slackChannelId),
    // Both null or both set; a half-written link can't exist.
    check(
      "projects_slack_channel_shape",
      sql`(${t.slackChannelId} is null and ${t.slackChannelName} is null)
       or (${t.slackChannelId} is not null and ${t.slackChannelName} is not null)`,
    ),
    // One Drive folder is linked to at most one project — the mirror of
    // `opportunities_sales_drive_folder_idx`.
    uniqueIndex("projects_drive_folder_idx").on(t.driveFolderId),
    // Both null or both set; a half-written folder link can't exist.
    check(
      "projects_drive_folder_shape",
      sql`(${t.driveFolderId} is null and ${t.driveFolderName} is null)
       or (${t.driveFolderId} is not null and ${t.driveFolderName} is not null)`,
    ),
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
    // The hourly rate this line bills at, in `BILL_RATE_CURRENCY`. This is a BILL
    // rate (revenue); a role never carries a cost — cost is derived from the
    // assignee's compensation and gated behind `projects.viewMargin`, see
    // `getProjectCostBasis`.
    //
    // SNAPSHOTTED from the code-owned card (`billRateFor`) when the role is created,
    // then editable. Revising the card prices FUTURE roles and deliberately does not
    // re-price existing ones, so a plan's revenue stays reproducible from its own
    // rows (ADR 0066, reversing ADR 0053).
    //
    // NOT NULL with **no default**, deliberately: a DB default would put the card's
    // figure in a second home, ignore per-cell exceptions, and silently paper over
    // any write path that forgot to snapshot. Every insert goes through a role schema,
    // which fills this via `snapshotBillRate` — so a new insert site that skips the
    // schema fails loudly instead of inventing a price.
    //
    // No sibling currency column: the card has exactly one currency, so the FX story
    // of ADR 0053 §8 is unchanged (one `noteConversion` call site).
    billRate: numeric({ precision: 12, scale: 2, mode: "number" }).notNull(),
    createdAt: timestamp().defaultNow().notNull(),
  },
  (t) => [
    index("project_roles_project_idx").on(t.projectId),
    index("project_roles_staff_idx").on(t.staffId),
    index("project_roles_opportunity_idx").on(t.opportunityId),
    // A free or negative bill rate is never a real price — keep it out of the table
    // so no import or backfill can plant one.
    check("project_roles_bill_rate_positive", sql`${t.billRate} > 0`),
  ],
);

// Delivery notes: a dated write-up of how an engagement is actually going, plus
// the author's own 1–10 health rating. Like `performance_review_note` this is a
// DOCUMENT, not a fact about the project — nothing here supersedes anything, and
// `projects` carries no `health` column of its own. "How is this project doing" is
// answered by the LATEST note (see `getProjectsList`), so a stored scalar would be
// a hand-maintained duplicate of the newest row that silently disagrees with it
// the moment a note is edited or deleted. Same "derive it, don't store it" call as
// status and line of business above.
//
// Unlike a review note there is NO lifecycle and no draft: reads are open like
// every other project read, and writes — create, edit and delete alike — are the
// static `projects.edit` capability, so the team that runs the engagement can
// correct its record. `authorStaffId` is therefore ATTRIBUTION ONLY and is never
// an authorization input (contrast `performance_review_note.authorUserId`, where
// it is). See docs/decisions/0059.
export const projectDeliveryNotes = pgTable(
  "project_delivery_notes",
  {
    id: text().primaryKey(),
    // `cascade`: a note is meaningless without its engagement (as `project_roles`).
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Who wrote it. Author = staff, matching the other people-FKs in this domain
    // (`projectRoles.staffId`) and so the panel
    // can link the name to /staff/[id]. `set null` because this is attribution,
    // not ownership: losing it narrows nothing, since the write gate is a
    // capability rather than the author. A signed-in user with no staff row (an
    // admin, say) writes an unattributed note — the cost CRM entries already accept.
    authorStaffId: text().references(() => staff.id, { onDelete: "set null" }),
    // The date the note is ABOUT — `createdAt` is when it was typed. Named after
    // `performanceReviewNote.noteDate`; labelled simply "Date" in the UI.
    noteDate: date().notNull(),
    // Optional, so a weekly note doesn't demand a headline; the panel falls back
    // to the date, exactly as the review-notes panel does.
    title: text(),
    body: text().notNull(),
    // The 1–10 health rating, in ITS OWN COLUMN rather than jsonb — the same
    // reasoning as `staffSelfEvaluation.selfRating` (ADR 0058): it is the only
    // part of a note with a closed value set, the only thing anything aggregates
    // on, and the one value a LIST ROW needs without parsing jsonb.
    //
    // `notNull` so the list's rule stays statable in one sentence ("the latest
    // note's health"); a nullable rating would force a look-further-back clause
    // nobody wants to explain or test. It is also unreachable from the only UI
    // that writes it — `StarRating` has no clear affordance.
    projectHealth: integer().notNull(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // Serves BOTH readers with one index, in the exact direction each wants: the
    // detail read (`project_id = $1 order by note_date desc, created_at desc`) and
    // the list's `distinct on (project_id)` over a scoped id set, whose order by is
    // `project_id, note_date desc, created_at desc`. The trailing `.desc()` calls
    // are load-bearing, not decoration — Postgres can only walk a btree backwards
    // for a WHOLLY reversed ordering, so a plain ascending index cannot supply this
    // mixed direction and would force a sort node.
    index("project_delivery_notes_project_date_idx").on(
      t.projectId,
      t.noteDate.desc(),
      t.createdAt.desc(),
    ),
    // The scale as a DB invariant, so an out-of-range rating can't reach the
    // low-health flag from a future import or a hand-written update. Mirrors
    // `projects_budget_shape`. NOT a pgEnum: a numeric rating in a pgEnum stores
    // strings and needs an `alter type` to widen the scale. Bounds come from the
    // scale module via `sql.raw` (a bare `${number}` would emit a bind parameter,
    // which a check constraint can't carry) so the DB and zod can't drift.
    check(
      "project_delivery_notes_health_range",
      sql`${t.projectHealth} between ${sql.raw(String(PROJECT_HEALTH_MIN))} and ${sql.raw(String(PROJECT_HEALTH_MAX))}`,
    ),
  ],
);

// --- Row types -------------------------------------------------------------

export type Project = InferSelectModel<typeof projects>;
export type ProjectDeliveryNote = InferSelectModel<typeof projectDeliveryNotes>;
