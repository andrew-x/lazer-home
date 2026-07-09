import type { InferSelectModel } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { FEEDBACK_RATINGS } from "@/lib/feedback-rating";
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

// Shared source of truth for the values lives in `@/lib/feedback-rating` (a pure
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

// --- Row types -------------------------------------------------------------

export type Feedback = InferSelectModel<typeof feedback>;
