import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db/db";
import { responses } from "@/lib/db/schema";
import {
  WAYS_OF_WORKING_QUESTION_IDS,
  type WowQuestionId,
} from "@/lib/ways-of-working";

/** One question's stored answer. A question uses exactly one shape; the other
 * stays null. Both null → unanswered. */
export type WowAnswer = {
  textResponse: string | null;
  listResponse: string[] | null;
};

/** A person's Ways of Working answers, keyed by question id (every id present,
 * unanswered ones null on both shapes), plus how many are answered. */
export type WaysOfWorking = {
  answers: Record<WowQuestionId, WowAnswer>;
  answeredCount: number;
  totalCount: number;
};

function isAnswered({ textResponse, listResponse }: WowAnswer): boolean {
  return (
    textResponse !== null || (listResponse !== null && listResponse.length > 0)
  );
}

/**
 * A person's Ways of Working survey answers. NOT ownership-scoped — like
 * `getManualOfMe`/`getStaffProfile`, profiles (and these answers) are visible to
 * any signed-in viewer; auth is the `(app)` layout. Editing is the write-side
 * boundary (`upsertResponse`'s `authorizeStaffEdit`).
 *
 * Wrapped in `React.cache` so a page and its `generateMetadata` share one query.
 */
export const getWaysOfWorking = cache(
  async (staffId: string): Promise<WaysOfWorking> => {
    const rows = await db
      .select({
        questionId: responses.questionId,
        textResponse: responses.textResponse,
        listResponse: responses.listResponse,
      })
      .from(responses)
      .where(
        and(
          eq(responses.staffId, staffId),
          inArray(responses.questionId, [...WAYS_OF_WORKING_QUESTION_IDS]),
        ),
      );

    const byId = new Map(rows.map((row) => [row.questionId, row]));

    const answers = {} as Record<WowQuestionId, WowAnswer>;
    let answeredCount = 0;
    for (const questionId of WAYS_OF_WORKING_QUESTION_IDS) {
      const row = byId.get(questionId);
      const answer: WowAnswer = {
        textResponse: row?.textResponse ?? null,
        listResponse: row?.listResponse ?? null,
      };
      answers[questionId] = answer;
      if (isAnswered(answer)) answeredCount += 1;
    }

    return {
      answers,
      answeredCount,
      totalCount: WAYS_OF_WORKING_QUESTION_IDS.length,
    };
  },
);
