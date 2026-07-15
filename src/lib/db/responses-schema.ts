import type { InferSelectModel } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { staff } from "./staff-schema";

// ---------------------------------------------------------------------------
// Survey responses domain
//
// A GENERIC store for survey-style answers, keyed by (staffId, questionId).
// `questionId` is plain text — the set of valid ids is owned by the app (pure
// modules like `@/lib/manual-of-me`) and validated at the zod layer, so adding a
// new survey needs NO migration. It is deliberately not a pgEnum: growing an
// enum requires an out-of-band `ALTER TYPE ... ADD VALUE`, at odds with a table
// meant to serve many surveys.
//
// Each person has at most one response per question (unique below), so writes
// upsert (onConflictDoUpdate) — a survey answer is a current value, not
// append-only history. A row carries whichever of the three response shapes its
// question needs; the Manual of Me survey (its first consumer) uses
// `textResponse` only. See docs/domains/staff-profiles.md.
// ---------------------------------------------------------------------------

export const responses = pgTable(
  "responses",
  {
    id: text().primaryKey(),
    staffId: text()
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),

    // Which question this answers. Relates to a hardcoded TS id tuple (e.g.
    // MANUAL_OF_ME_QUESTION_IDS); validated in zod, not by a pgEnum.
    questionId: text().notNull(),

    // Exactly one shape is used per question type; all nullable. An unanswered
    // question has no row at all — a present row may still null out a cleared answer.
    listResponse: jsonb().$type<string[]>(),
    textResponse: text(),
    jsonResponse: jsonb(),

    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // At most one response per person per question → enables onConflictDoUpdate.
    unique("responses_staff_question_unique").on(t.staffId, t.questionId),
    index("responses_staff_idx").on(t.staffId),
  ],
);

export type Response = InferSelectModel<typeof responses>;
