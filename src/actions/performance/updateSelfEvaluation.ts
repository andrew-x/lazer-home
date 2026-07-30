"use server";

import { eq } from "drizzle-orm";
import { authorizeSelfEvaluationMutate } from "@/actions/performance/selfEvaluationAccess";
import { updateSelfEvaluationSchema } from "@/actions/performance/selfEvaluations.schema";
import { revalidateStaffProfile } from "@/actions/staff/staffProfileMutation";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { staffSelfEvaluation } from "@/lib/db/schema";
import {
  buildSelfEvaluationEntries,
  SELF_EVALUATION_QUESTION_SET_VERSION,
} from "@/lib/performance/self-evaluation";

/**
 * Edit one's own self-evaluation — a typo fix or a second thought, not a rewrite of
 * history: `staffId`, `questionSetVersion` and `createdAt` are never touched, so the
 * record keeps saying when it was actually submitted. `updatedAt` moves, which is how
 * the panel marks a record as edited.
 *
 * **Refused once the question set has moved on.** The form only shows the *current*
 * questions and this replaces `answers` wholesale, so editing an older record would
 * silently delete its answers to retired questions and re-label the surviving ones —
 * data loss on an edit, the exact failure the stored snapshot exists to prevent. The
 * version is re-read from the DB rather than taken from the client (the
 * `requireDraftPlan` discipline: never trust the client for state). Delete stays
 * available, so a stale record isn't stuck.
 *
 * Authorization (author only — no capability path, no admin override) is enforced by
 * `authorizeSelfEvaluationMutate` before this body runs.
 */
export const updateSelfEvaluation = secureActionClient
  .metadata({
    action: "update-self-evaluation",
    authorize: authorizeSelfEvaluationMutate,
  })
  .inputSchema(updateSelfEvaluationSchema)
  .action(async ({ parsedInput }) => {
    const [existing] = await db
      .select({
        staffId: staffSelfEvaluation.staffId,
        questionSetVersion: staffSelfEvaluation.questionSetVersion,
      })
      .from(staffSelfEvaluation)
      .where(eq(staffSelfEvaluation.id, parsedInput.evaluationId))
      .limit(1);

    if (!existing) {
      throw new UserSafeActionError("That self-evaluation no longer exists.");
    }

    if (existing.questionSetVersion !== SELF_EVALUATION_QUESTION_SET_VERSION) {
      throw new UserSafeActionError(
        "This self-evaluation answers an earlier set of questions, so it can't be edited. Add a new one instead.",
      );
    }

    await db
      .update(staffSelfEvaluation)
      .set({
        selfRating: parsedInput.selfRating,
        answers: buildSelfEvaluationEntries(parsedInput.answers),
      })
      .where(eq(staffSelfEvaluation.id, parsedInput.evaluationId));

    revalidateStaffProfile(existing.staffId);
    return { ok: true };
  });
