import "server-only";

import { desc, eq } from "drizzle-orm";
import { ownStaffId } from "@/actions/staff/ownStaffId";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { db } from "@/lib/db/db";
import { staffSelfEvaluation } from "@/lib/db/schema";
import type { FeedbackRating } from "@/lib/performance/feedback-rating";
import {
  SELF_EVALUATION_QUESTION_SET_VERSION,
  type SelfEvaluationAnswer,
} from "@/lib/performance/self-evaluation";

/** One saved self-evaluation, as its reader is allowed to see it. */
export type SelfEvaluationRow = {
  id: string;
  /** Which question set the answers were written against. */
  questionSetVersion: number;
  /** The person's OWN five-point self-assessment — see the warning below. */
  selfRating: FeedbackRating;
  /** Answers with their section/prompt as presented when written. */
  answers: SelfEvaluationAnswer[];
  /** When it was submitted — this record's only date. */
  createdAt: Date;
  updatedAt: Date;
  /**
   * Whether THIS reader may edit or delete it: the author only, and only while the
   * record's question set is still the current one. Editing an older set's record
   * would silently drop its answers to questions the form no longer shows.
   */
  canManage: boolean;
};

export type StaffSelfEvaluationsView = {
  /** Whether this reader may start a new one — their own profile only. */
  canCreate: boolean;
  /** Whether this reader is the person the evaluations are about. */
  isSelf: boolean;
  evaluations: SelfEvaluationRow[];
};

/**
 * One person's self-evaluations, newest first, projected for the caller. Serves both
 * surfaces — the profile tab and the compensation-plan review drawer.
 *
 * Two readers: **the person themselves**, who may also write; and any holder of
 * **`ratings.view`** (manager/admin), read-only. Returns **`null`** for anyone else,
 * so the tab isn't rendered at all — `[]` means "permitted, nothing written yet",
 * and keeping those distinct matters: a tab that appeared for everyone would itself
 * disclose that self-evaluations exist.
 *
 * !! `selfRating` IS NOT A `staffRating` LEVEL !!
 * This read reuses the `ratings.view` capability, which guards manager-assigned
 * L0–L4 levels that a staffer must never see about themselves (ADR 0032). The two
 * coexist only because they guard different data: a self-rating is the person's own
 * five-word self-assessment, on a different scale, written by them. **This read must
 * never join `staffRating` or project a level**, and the Self-evaluations tab must
 * never render one beside a self-rating — "showing the assigned level for
 * comparison" is exactly how ADR 0032 would quietly end.
 *
 * Note also that `ratings.view` is *wider* than the reporting line, so a manager can
 * read the self-evaluations of someone who doesn't report to them — while their own
 * review notes about that person are reporting-line-gated and narrower. That is a
 * deliberate consequence of matching the Evaluations tab's gate; see
 * docs/domains/permissions.md.
 */
export async function getStaffSelfEvaluations(
  staffId: string,
): Promise<StaffSelfEvaluationsView | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  // Plain `ownStaffId` (not `activeOnly`) to match `authorizeSelfEvaluationMutate`:
  // this resolves the caller only to recognise their own record.
  const callerStaffId = await ownStaffId(user.id);
  // Checked FIRST because it decides `canCreate`/`canManage` — a capability holder
  // looking at their own profile must get the write affordances, not just the read.
  const isSelf = callerStaffId !== null && callerStaffId === staffId;

  if (!isSelf && !userHasPermission(user, { ratings: ["view"] })) return null;

  const rows = await db
    .select({
      id: staffSelfEvaluation.id,
      questionSetVersion: staffSelfEvaluation.questionSetVersion,
      selfRating: staffSelfEvaluation.selfRating,
      answers: staffSelfEvaluation.answers,
      createdAt: staffSelfEvaluation.createdAt,
      updatedAt: staffSelfEvaluation.updatedAt,
    })
    .from(staffSelfEvaluation)
    .where(eq(staffSelfEvaluation.staffId, staffId))
    // Newest submission first. A timestamp needs no tiebreaker, unlike the
    // date-plus-createdAt ordering the dated review notes need.
    .orderBy(desc(staffSelfEvaluation.createdAt));

  return {
    canCreate: isSelf,
    isSelf,
    evaluations: rows.map((row) => ({
      ...row,
      canManage:
        isSelf &&
        row.questionSetVersion === SELF_EVALUATION_QUESTION_SET_VERSION,
    })),
  };
}
