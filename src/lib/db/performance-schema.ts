import type { InferSelectModel } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { COMPENSATION_PLAN_STATUSES } from "@/lib/performance/compensation-plan";
import { FEEDBACK_RATINGS } from "@/lib/performance/feedback-rating";
import type { Subratings } from "@/lib/performance/rating-rubric";
import { MAX_RATING_LEVEL, MIN_RATING_LEVEL } from "@/lib/staff/staff-rating";
import { user } from "./auth-schema";
import { currencyEnum, employmentTypeEnum, staff } from "./staff-schema";

// ---------------------------------------------------------------------------
// Performance management domain
//
// `feedback` is peer feedback: any active staff member can leave structured
// feedback about another. It is a point-in-time record (immutable once left, no
// effective-dating). Privacy is enforced by the reads that project it, NOT by
// this table: recipients may see only the `messageToRecipient` + the giver's
// name, while `feedback.review` (manager/admin) sees everything. See
// docs/domains/performance.md.
// ---------------------------------------------------------------------------

// Shared source of truth for the values lives in `@/lib/performance/feedback-rating` (a pure
// module) so the pgEnum here and the zod enum / form labels there stay in sync.
export const feedbackRatingEnum = pgEnum("feedback_rating", [
  ...FEEDBACK_RATINGS,
]);

export const feedback = pgTable(
  "feedback",
  {
    id: text().primaryKey(),
    // Who wrote it and who it's about. Both cascade: feedback is meaningless
    // without both people. Duplicate (from, to) pairs are legitimate — a person
    // can leave feedback more than once — so there is no unique constraint.
    fromStaffId: text()
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    toStaffId: text()
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),

    rating: feedbackRatingEnum().notNull(),
    // How/when the giver worked with the person. Required.
    context: text().notNull(),

    // Optional structured prompts + free-form notes. Never shown to the recipient.
    keepDoing: text(),
    stopDoing: text(),
    startDoing: text(),
    other: text(),

    // The ONLY field visible to the recipient (alongside the giver's name).
    messageToRecipient: text(),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("feedback_to_staff_idx").on(t.toStaffId),
    index("feedback_from_staff_idx").on(t.fromStaffId),
  ],
);

// ---------------------------------------------------------------------------
// Staff ratings (overall level, L0–L4)
//
// A staffer's overall performance level. Effective-dated exactly like
// `staffEmployment` (ADR 0007): saving an evaluation spawns a NEW dated row, and
// the current level is the row with the latest `effectiveDate` (createdAt breaks
// same-day ties, `latestRatingFirst`). `level` is nullable so "unrated" is a
// real, historied event (a manager can set someone back to no rating); a staffer
// with no rows is likewise unrated.
//
// Ratings are sensitive: only `ratings.view` (manager/admin) may read them; the
// reads that project ratings enforce this, and staff never see their own. See
// docs/domains/performance.md.
// ---------------------------------------------------------------------------

export const staffRating = pgTable(
  "staff_rating",
  {
    id: text().primaryKey(),
    staffId: text()
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    effectiveDate: date().notNull(),

    // The overall level, 0–4. Null = explicitly unrated as of this date.
    level: integer(),

    // Per-category subratings (each L1–L4), keyed by the role's rubric
    // (`@/lib/performance/rating-rubric`). Null/absent = no subratings recorded.
    // The overall `level` is independent — subratings are extra detail, not a
    // derivation of it. The shape (which keys are valid per role) is owned by the
    // rubric module and validated at the zod/action layer, not the DB — mirrors
    // the survey `responses` jsonb, so adding a rubric needs no migration.
    subratings: jsonb().$type<Subratings>(),

    // Who saved this evaluation (audit). Nullable + `set null` so a rating's
    // history survives the evaluator's staff/user record being removed.
    evaluatedByUserId: text().references(() => user.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("staff_rating_staff_idx").on(t.staffId),
    check(
      "staff_rating_level_range",
      // Bounds are trusted numeric constants — embed as raw literals so they land
      // in the CHECK DDL rather than as bind parameters.
      sql`${t.level} is null or (${t.level} >= ${sql.raw(String(MIN_RATING_LEVEL))} and ${t.level} <= ${sql.raw(String(MAX_RATING_LEVEL))})`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Compensation change plans
//
// A plan is a named, effective-dated PROPOSAL covering a cohort of staff: for
// each person a proposed rating (level + subratings), a proposed compensation
// figure, the workflow state of the review conversation, and notes.
//
// Committing a plan writes the ratings as new dated `staffRating` rows — and
// nothing else. Compensation stays a proposal: Rippling remains the sole writer
// of `staffEmployment` (ADR 0020), so a committed plan keeps comparing its
// proposal against live comp and flags anything not yet applied upstream.
//
// Unlike the aggregate `/performance` reads (which are deliberately identity-
// free), this surface is inherently per-person. It carries the stricter combined
// gate — `staff.viewCompensation` AND `ratings.edit` — on every read and write.
// See docs/domains/performance.md.
// ---------------------------------------------------------------------------

// Values live in `@/lib/performance/compensation-plan` (a pure module) so this
// pgEnum, the zod schemas, and the status labels share one source of truth.
export const compensationPlanStatusEnum = pgEnum("compensation_plan_status", [
  ...COMPENSATION_PLAN_STATUSES,
]);

export const compensationPlan = pgTable("compensation_plan", {
  id: text().primaryKey(),
  name: text().notNull(),
  status: compensationPlanStatusEnum().notNull().default("DRAFT"),

  // The date committed ratings are dated with. Editable while the plan is a
  // draft, frozen once committed.
  effectiveDate: date().notNull(),

  // Audit. `set null` on both: a plan outlives the account that made it.
  createdByUserId: text().references(() => user.id, { onDelete: "set null" }),
  committedByUserId: text().references(() => user.id, { onDelete: "set null" }),
  // Null while draft. Set in the commit transaction, and the idempotency guard
  // that makes a second commit a no-op error rather than a duplicate write.
  committedAt: timestamp(),

  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const compensationPlanItem = pgTable(
  "compensation_plan_item",
  {
    id: text().primaryKey(),
    planId: text()
      .notNull()
      .references(() => compensationPlan.id, { onDelete: "cascade" }),
    // Cascade mirrors `staffRating`: an item is meaningless without the person.
    staffId: text()
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),

    // The proposed rating, mirroring `staffRating`'s shape exactly — commit
    // copies these straight across. Null level = proposing "unrated".
    level: integer(),
    subratings: jsonb().$type<Subratings>(),

    // The proposed compensation: ONE figure, compared against `base` for
    // FULL_TIME staff and `hourlyRate` for HOURLY (see `currentCompAmount`).
    // Null until entered. The currency may differ from the person's current one
    // (a CAD → USD move), which is why it is stored rather than assumed.
    plannedAmount: numeric({ precision: 12, scale: 2, mode: "number" }),
    plannedCurrency: currencyEnum(),

    // Workflow tracking for the review conversation. Deliberately independent of
    // content — a rating can exist before the meeting happens, and vice versa.
    ratingDone: boolean().notNull().default(false),
    meetingDone: boolean().notNull().default(false),
    isComplete: boolean().notNull().default(false),

    evaluationNotes: text(),
    compensationNotes: text(),

    // Frozen in the commit transaction: what the person's compensation actually
    // was at the moment the plan was committed. Null while draft (the editor
    // reads live comp instead). `snapshotEmploymentType` records WHICH figure
    // `plannedAmount` was compared against, so an annual base can never later be
    // misread as an hourly rate if the person switches.
    snapshotAmount: numeric({ precision: 12, scale: 2, mode: "number" }),
    snapshotCurrency: currencyEnum(),
    snapshotEmploymentType: employmentTypeEnum(),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("compensation_plan_item_plan_idx").on(t.planId),
    // One item per person per plan — makes "add staff" idempotent.
    uniqueIndex("compensation_plan_item_plan_staff_uq").on(t.planId, t.staffId),
    check(
      "compensation_plan_item_level_range",
      // Same bounds as `staff_rating` — a proposed level must be a valid level.
      sql`${t.level} is null or (${t.level} >= ${sql.raw(String(MIN_RATING_LEVEL))} and ${t.level} <= ${sql.raw(String(MAX_RATING_LEVEL))})`,
    ),
  ],
);

// --- Row types -------------------------------------------------------------

export type Feedback = InferSelectModel<typeof feedback>;
export type CompensationPlan = InferSelectModel<typeof compensationPlan>;
export type CompensationPlanItem = InferSelectModel<
  typeof compensationPlanItem
>;
