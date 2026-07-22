import type { InferSelectModel } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { FEEDBACK_RATINGS } from "@/lib/performance/feedback-rating";
import { MAX_RATING_LEVEL, MIN_RATING_LEVEL } from "@/lib/staff/staff-rating";
import { user } from "./auth-schema";
import { staff } from "./staff-schema";

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

// --- Row types -------------------------------------------------------------

export type Feedback = InferSelectModel<typeof feedback>;
export type StaffRating = InferSelectModel<typeof staffRating>;
