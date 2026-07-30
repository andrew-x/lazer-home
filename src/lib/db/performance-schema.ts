import type { InferSelectModel } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
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
import {
  COMPENSATION_PLAN_ITEM_STATUSES,
  COMPENSATION_PLAN_STATUSES,
} from "@/lib/performance/compensation-plan";
import { FEEDBACK_RATINGS } from "@/lib/performance/feedback-rating";
import type { Subratings } from "@/lib/performance/rating-rubric";
import { PERFORMANCE_REVIEW_NOTE_STATUSES } from "@/lib/performance/review-note";
import type { SelfEvaluationAnswer } from "@/lib/performance/self-evaluation";
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
// Unlike the aggregate `/dashboards` reads (which are deliberately identity-
// free), this surface is inherently per-person. It carries the stricter combined
// gate — `staff.viewCompensation` AND `ratings.edit` — on every read and write.
// See docs/domains/performance.md.
// ---------------------------------------------------------------------------

// Values live in `@/lib/performance/compensation-plan` (a pure module) so this
// pgEnum, the zod schemas, and the status labels share one source of truth.
export const compensationPlanStatusEnum = pgEnum("compensation_plan_status", [
  ...COMPENSATION_PLAN_STATUSES,
]);

// Same convention: the per-item workflow ladder is declared in the pure module.
export const compensationPlanItemStatusEnum = pgEnum(
  "compensation_plan_item_status",
  [...COMPENSATION_PLAN_ITEM_STATUSES],
);

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

    // The proposed ONGOING compensation: ONE figure, compared against `base` for
    // FULL_TIME staff and `hourlyRate` for HOURLY (see `currentCompAmount`).
    // Null until entered.
    plannedAmount: numeric({ precision: 12, scale: 2, mode: "number" }),

    // A one-off discretionary bonus proposed alongside the ongoing figure. A LUMP
    // SUM, not a rate: it is never restated by the editor's annual/hourly toggle,
    // and it is deliberately absent from the Change and Gap columns, which are
    // about ongoing compensation (and compare against an annual level target).
    plannedBonus: numeric({ precision: 12, scale: 2, mode: "number" }),

    // The currency BOTH proposed figures above are denominated in — one currency
    // per row. It may differ from the person's current one (a CAD → USD move),
    // which is why it is stored rather than assumed.
    plannedCurrency: currencyEnum(),

    // How far the review conversation has got: ONE ordered ladder, not a set of
    // independent flags. This replaced three booleans
    // (`ratingDone`/`meetingDone`/`isComplete`) which could represent nonsense —
    // "complete" without a rating, a meeting logged against nothing. An exclusive
    // column makes those states unrepresentable rather than merely discouraged.
    status: compensationPlanItemStatusEnum().notNull().default("NOT_STARTED"),

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

// ---------------------------------------------------------------------------
// Performance review notes
//
// A dated write-up of a review conversation, with a two-step lifecycle: a
// manager drafts it (only they see it) and then SHARES it, after which the
// person it is about can read it too. Not effective-dated — a note is a
// document, not a fact about a person (same reasoning as `compensationPlan`).
//
// UNLIKE every other table here, who may read a row depends on the REPORTING
// LINE (`staff.managerId`), not only on a role capability — the first place the
// reporting graph is an authorization input rather than a display field. The
// decision lives in `src/actions/performance/reviewNoteAccess.ts`; the reads
// project accordingly. See docs/domains/performance.md and the ADR.
// ---------------------------------------------------------------------------

// Values live in `@/lib/performance/review-note` (a pure module) so this pgEnum
// and the status labels / zod schemas share one source of truth.
export const performanceReviewNoteStatusEnum = pgEnum(
  "performance_review_note_status",
  [...PERFORMANCE_REVIEW_NOTE_STATUSES],
);

export const performanceReviewNote = pgTable(
  "performance_review_note",
  {
    id: text().primaryKey(),
    // Who the note is about. Cascade: a note is meaningless without the person.
    staffId: text()
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),

    // Audit AND an authorization input (the author of a note may always manage
    // it, even after they stop being the person's manager). `set null` fails
    // CLOSED: losing the author row narrows access to manager/admin, never
    // widens it.
    authorUserId: text().references(() => user.id, { onDelete: "set null" }),

    // The date of the conversation being documented — not the date it was typed.
    noteDate: date().notNull(),

    title: text(),
    body: text().notNull(),

    status: performanceReviewNoteStatusEnum().notNull().default("DRAFT"),
    // Null while draft. Set when shared, and the idempotency guard that makes a
    // second share an error rather than a silent re-stamp.
    sharedAt: timestamp(),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("performance_review_note_staff_idx").on(t.staffId)],
);

// ---------------------------------------------------------------------------
// Staff self-evaluations
//
// A questionnaire a person fills out ABOUT THEMSELVES: free-text reflection prompts
// plus one overall self-rating. Like `performanceReviewNote` it is a document, not a
// fact about a person, so nothing here supersedes anything — but unlike a note it
// carries no author-chosen date at all. Because there is no draft state, `createdAt`
// IS the submission time, and a separate "period covered" column would just be a
// second, hand-maintained copy of it.
//
// `answers` stores a SNAPSHOT: each entry carries the section and prompt as they
// were presented when answered, so a record reads back exactly as written even
// after the question set is reworded or a question retires. The shape is owned by
// `@/lib/performance/self-evaluation` and validated at the zod/action layer, not
// the DB — same arrangement as `staffRating.subratings` and the survey
// `responses` jsonb, so changing the questions needs no migration.
//
// Reads are gated on `ratings.view` — with, unlike `staffRating`, a FULL OWNER
// PATH: this is the person's own writing, so they always see (and are the only one
// who may write) their own. See `getStaffSelfEvaluations`.
//
// !! `selfRating` IS NOT `staffRating.level` !! It is the person's own five-point
// self-assessment, on a different scale, chosen by them. ADR 0032 keeps
// manager-assigned levels invisible to the person they are about; nothing here may
// join `staffRating` or render a level beside a self-rating. See
// docs/domains/performance.md.
// ---------------------------------------------------------------------------

// The scale IS peer feedback's five words, so the TS tuple in
// `@/lib/performance/feedback-rating` is shared (ADR 0016) — but this is a
// SEPARATE pg type rather than a reuse of `feedback_rating`, so peer-feedback
// churn never forces an `ALTER TYPE` on a type two tables depend on.
export const selfEvaluationRatingEnum = pgEnum("self_evaluation_rating", [
  ...FEEDBACK_RATINGS,
]);

export const staffSelfEvaluation = pgTable(
  "staff_self_evaluation",
  {
    id: text().primaryKey(),

    // Subject AND author: only the subject may write one, so a separate author
    // column would be a redundant copy of this one. An "on behalf of" path would
    // be a migration — deliberately not pre-built. Cascade: the document is
    // meaningless without the person.
    staffId: text()
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),

    // Which question set the answers below were written against. A column rather
    // than a jsonb field so "how many records still answer the v1 questions" is a
    // plain query, and so the update action can refuse to edit a record whose set
    // has moved on.
    questionSetVersion: integer().notNull(),

    // The overall self-assessment. Its own column, not a jsonb entry: it is the
    // only answer with a closed value set (so the DB can actually constrain it),
    // the only one anything will aggregate or filter on, and the one a list row
    // needs to badge without parsing jsonb. Exactly the typed-`level` vs
    // jsonb-`subratings` split above. `notNull` guarantees no record is entirely
    // empty, since every free-text answer may be blank.
    selfRating: selfEvaluationRatingEnum().notNull(),

    // The free-text answers, in the order they were presented. `[]` is legal — a
    // record with only a self-rating is a valid, if thin, record.
    answers: jsonb().$type<SelfEvaluationAnswer[]>().notNull(),

    // When it was submitted — this record's only date, and the one it is ordered
    // and displayed by. No unique constraint with `staffId`: a person may submit
    // more than one, and a timestamp orders them without needing a tiebreaker.
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("staff_self_evaluation_staff_idx").on(t.staffId)],
);

// --- Row types -------------------------------------------------------------

export type Feedback = InferSelectModel<typeof feedback>;
export type StaffSelfEvaluation = InferSelectModel<typeof staffSelfEvaluation>;
export type PerformanceReviewNote = InferSelectModel<
  typeof performanceReviewNote
>;
export type CompensationPlan = InferSelectModel<typeof compensationPlan>;
export type CompensationPlanItem = InferSelectModel<
  typeof compensationPlanItem
>;
