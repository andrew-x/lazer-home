"use server";

import { eq } from "drizzle-orm";
import { authorizeSelfEvaluationMutate } from "@/actions/performance/selfEvaluationAccess";
import { deleteSelfEvaluationSchema } from "@/actions/performance/selfEvaluations.schema";
import { revalidateStaffProfile } from "@/actions/staff/staffProfileMutation";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { staffSelfEvaluation } from "@/lib/db/schema";

/**
 * Delete one's own self-evaluation. With no draft state, this is the **only** way to
 * take back something saved too early — and since it's the person's own words, it is
 * their call alone.
 *
 * Works regardless of question-set version, unlike editing: a record too old to
 * amend must still be retractable.
 *
 * Authorization (author only — no capability path, no admin override) is enforced by
 * `authorizeSelfEvaluationMutate` before this body runs.
 */
export const deleteSelfEvaluation = secureActionClient
  .metadata({
    action: "delete-self-evaluation",
    authorize: authorizeSelfEvaluationMutate,
  })
  .inputSchema(deleteSelfEvaluationSchema)
  .action(async ({ parsedInput }) => {
    const [row] = await db
      .delete(staffSelfEvaluation)
      .where(eq(staffSelfEvaluation.id, parsedInput.evaluationId))
      .returning({ staffId: staffSelfEvaluation.staffId });

    if (!row) {
      throw new UserSafeActionError("That self-evaluation no longer exists.");
    }

    revalidateStaffProfile(row.staffId);
    return { ok: true };
  });
