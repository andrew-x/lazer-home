import "server-only";

import { eq } from "drizzle-orm";
import { ownStaffId } from "@/actions/staff/ownStaffId";
import type { ActionAuthorize } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { staffSelfEvaluation } from "@/lib/db/schema";

/**
 * Who may mutate a self-evaluation: **its author, and nobody else.**
 *
 * There is no capability path and **no admin override** — deliberately unlike
 * `reviewNoteAccess`, where admin *is* a blanket override because a manager writing
 * about someone else needs an escalation route. A self-evaluation is a first-person
 * document with no separate author column, so a third party editing it would be
 * putting words in someone's mouth, undetectably. `ratings.view` grants reading it
 * (see `getStaffSelfEvaluations`) and nothing more; `ratings.edit` means "assign
 * levels" and doesn't apply. If HR ever needs a retraction path, that is a separate,
 * audited action — not a widening of this hook.
 */

/** Deny with the same user-safe message every other gate in the app uses. */
function deny(): never {
  throw new UserSafeActionError("You don't have permission to do that.");
}

/**
 * Action `authorize` hook for **editing / deleting** a self-evaluation: gates on the
 * input's `evaluationId`, resolving the record's subject itself — the client never
 * says whose record it is. Any action using it must take `evaluationId: string`.
 *
 * A missing record denies with the same message as a forbidden one, so this can't be
 * used to probe which ids exist.
 */
export const authorizeSelfEvaluationMutate: ActionAuthorize = async ({
  user,
  clientInput,
}) => {
  const evaluationId = (clientInput as { evaluationId?: unknown }).evaluationId;
  if (typeof evaluationId !== "string") deny();

  const [row] = await db
    .select({ staffId: staffSelfEvaluation.staffId })
    .from(staffSelfEvaluation)
    .where(eq(staffSelfEvaluation.id, evaluationId))
    .limit(1);

  if (!row) deny();

  // Plain `ownStaffId`, NOT `activeOnly: true`. This is an *ownership* check: the
  // caller's identity is resolved only to compare against their OWN row, so a
  // terminated-but-still-signed-in caller reaches nothing but themselves — harmless,
  // and the `(app)` layout gives them no page to do it from anyway. `activeOnly`
  // belongs on checks that use the caller's identity to reach *other people's* data
  // (`reviewNoteAccess`, `canGiveFeedback`), where "are you still one of us" is part
  // of the question. Same reasoning as `canEditStaff` / `canViewCompensation`.
  const callerStaffId = await ownStaffId(user.id);
  if (callerStaffId === null || callerStaffId !== row.staffId) deny();
};
