import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db/db";
import { responses } from "@/lib/db/schema";
import {
  MANUAL_OF_ME_QUESTION_IDS,
  MANUAL_OF_ME_QUESTIONS,
  type ManualOfMeQuestionId,
} from "@/lib/staff/manual-of-me";

/**
 * One Manual of Me question paired with this person's answer (null if
 * unanswered). The question copy is merged in from `@/lib/staff/manual-of-me` so
 * callers get everything they need to render without re-importing the defs.
 */
export type ManualOfMeEntry = {
  id: ManualOfMeQuestionId;
  title: string;
  subtitle: string;
  textResponse: string | null;
};

/**
 * A person's Manual of Me answers, in canonical question order. NOT
 * ownership-scoped — like `getStaffProfile`, profiles (and these answers) are
 * visible to any signed-in viewer; auth is the `(app)` layout. Unanswered
 * questions still appear, with `textResponse: null`.
 *
 * Wrapped in `React.cache` so a page and its `generateMetadata` share one query.
 */
export const getManualOfMe = cache(
  async (staffId: string): Promise<ManualOfMeEntry[]> => {
    const rows = await db
      .select({
        questionId: responses.questionId,
        textResponse: responses.textResponse,
      })
      .from(responses)
      .where(
        and(
          eq(responses.staffId, staffId),
          inArray(responses.questionId, [...MANUAL_OF_ME_QUESTION_IDS]),
        ),
      );

    const byId = new Map(rows.map((row) => [row.questionId, row.textResponse]));

    return MANUAL_OF_ME_QUESTIONS.map((question) => ({
      id: question.id,
      title: question.title,
      subtitle: question.subtitle,
      textResponse: byId.get(question.id) ?? null,
    }));
  },
);
