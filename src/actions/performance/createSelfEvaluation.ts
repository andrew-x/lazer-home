"use server";

import { createSelfEvaluationSchema } from "@/actions/performance/selfEvaluations.schema";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { revalidateStaffProfile } from "@/actions/staff/staffProfileMutation";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { staffSelfEvaluation } from "@/lib/db/schema";
import {
  buildSelfEvaluationEntries,
  SELF_EVALUATION_QUESTION_SET_VERSION,
} from "@/lib/performance/self-evaluation";

/**
 * Save a new self-evaluation for the signed-in person.
 *
 * **Intentionally gated by nothing beyond `secureActionClient`'s auth**, and that is
 * not an omission: the input carries **no target id**, so there is nothing to forge.
 * The subject comes from `getCurrentStaffId()` below — you can only write a
 * self-evaluation as yourself — and an `authorize` hook would have no `clientInput`
 * field to read. Editing and deleting, which *do* take an id, are gated by
 * `authorizeSelfEvaluationMutate`.
 *
 * There is no draft state: once this returns, anyone who may see this person's
 * evaluations can read it (`SELF_EVALUATION_SAVE_WARNING` says so on the form).
 *
 * The stored `section`/`prompt` snapshot is derived here from the current question
 * set, never accepted from the client — see `selfEvaluations.schema.ts`.
 */
export const createSelfEvaluation = secureActionClient
  .metadata({ action: "create-self-evaluation" })
  .inputSchema(createSelfEvaluationSchema)
  .action(async ({ parsedInput }) => {
    const staffId = await getCurrentStaffId();
    if (!staffId) {
      throw new UserSafeActionError(
        "Your staff profile isn't set up yet, so there's nothing to evaluate against.",
      );
    }

    const [row] = await db
      .insert(staffSelfEvaluation)
      .values({
        id: generateId("sev"),
        staffId,
        questionSetVersion: SELF_EVALUATION_QUESTION_SET_VERSION,
        selfRating: parsedInput.selfRating,
        answers: buildSelfEvaluationEntries(parsedInput.answers),
      })
      .returning({ id: staffSelfEvaluation.id });

    revalidateStaffProfile(staffId);
    return { id: row.id };
  });
