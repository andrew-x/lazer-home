import "server-only";

import { eq } from "drizzle-orm";
import { ownStaffId } from "@/actions/staff/ownStaffId";
import { isAdmin } from "@/lib/auth/permissions";
import type { ActionAuthorize } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { performanceReviewNote, staff } from "@/lib/db/schema";

/**
 * !! THE ONE RELATIONSHIP-BASED GATE IN THIS CODEBASE !!
 *
 * Everywhere else, `staff.managerId` only ever *scopes* a result set the caller
 * was already entitled to see (ADR 0047: "the reporting line scopes, it never
 * grants"). Performance review notes are the deliberate exception: they are a
 * private conversation between a person and their manager, so the reporting line
 * *is* the boundary, and this module is the only place that decision lives.
 *
 * Consequences to keep in mind when touching this:
 *   - `managerId` is CSV-import-populated with no in-app editor (ADR 0026), so a
 *     bad import changes who can read AND write review notes.
 *   - It is not effective-dated: access follows the CURRENT reporting line. A
 *     manager who changes teams keeps only the notes they authored.
 *   - Role capabilities are NOT consulted. Holding `ratings.edit` or
 *     `feedback.review` grants nothing here; being the person's manager does.
 */

/** Deny with the same user-safe message every other gate in the app uses. */
function deny(): never {
  throw new UserSafeActionError("You don't have permission to do that.");
}

export type ReviewNoteAccess = {
  /** The caller's own linked staff id, or null when their account has none. */
  callerStaffId: string | null;
  /**
   * The caller IS the person the notes are about. They see SHARED notes only,
   * and can never manage them — a person is not their own review-note author.
   */
  isSubject: boolean;
  /**
   * The caller may draft, edit, share and delete notes about this person — and
   * therefore also read their drafts. True for an admin, or for the person's
   * current manager.
   */
  canManage: boolean;
};

/**
 * Who is this caller, relative to `targetStaffId`'s review notes? The single
 * decision point, used both as a UI affordance and as the basis for the two
 * `authorize` hooks below (the hooks are the real boundary — never the UI check).
 *
 * Rule: an **admin** may manage anyone's notes; otherwise the caller must be the
 * target's **current manager** (`staff.managerId`). The subject themselves gets
 * `isSubject` and nothing more.
 */
export async function getReviewNoteAccess(
  user: { id: string; role?: string | null },
  targetStaffId: string,
): Promise<ReviewNoteAccess> {
  // `activeOnly` matters here, unlike in `canEditStaff`: a terminated person can
  // keep a valid session until it expires, and their former reports' `managerId`
  // still points at them until the next CSV import. Without this they could go on
  // reading and writing private notes about those people through a direct action
  // call — the `(app)` layout refuses them, but an action isn't reached through
  // the layout. Same reasoning as `canGiveFeedback`.
  const callerStaffId = await ownStaffId(user.id, { activeOnly: true });
  const isSubject = callerStaffId !== null && callerStaffId === targetStaffId;

  if (isAdmin(user)) return { callerStaffId, isSubject, canManage: true };

  // An unlinked caller has no reporting line to stand on. And the subject path
  // stops here on purpose: `managerId` has no in-app editor and no cycle
  // detection beyond the importer's non-blocking `self` warning, so a row
  // pointing at itself is reachable through a bad CSV — without this guard it
  // would make someone their own note-manager and hand them their own drafts
  // (ADR 0047 applies the same self-exclusion to the reports feedback list).
  if (callerStaffId === null || isSubject) {
    return { callerStaffId, isSubject, canManage: false };
  }

  const [subject] = await db
    .select({ managerId: staff.managerId })
    .from(staff)
    .where(eq(staff.id, targetStaffId))
    .limit(1);

  return {
    callerStaffId,
    isSubject,
    canManage: subject?.managerId === callerStaffId,
  };
}

/**
 * Action `authorize` hook for **creating** a note: gates on the input's
 * `staffId` (the person the note is about). Wire it with
 * `metadata({ authorize: authorizeReviewNoteCreate })`. Any action using it must
 * take a `staffId: string` in its input.
 */
export const authorizeReviewNoteCreate: ActionAuthorize = async ({
  user,
  clientInput,
}) => {
  const staffId = (clientInput as { staffId?: unknown }).staffId;
  if (typeof staffId !== "string") deny();

  const { canManage } = await getReviewNoteAccess(user, staffId);
  if (!canManage) deny();
};

/**
 * Action `authorize` hook for **editing / sharing / deleting** an existing note:
 * gates on the input's `noteId`, which it resolves to the note's subject and
 * author itself — the client never says who a note is about.
 *
 * Adds the **author path** on top of `getReviewNoteAccess`: whoever wrote a note
 * may fix or delete it even after they stop being that person's manager —
 * otherwise a manager who changes teams strands their own words, unreachable to
 * correct and unreachable to retract.
 *
 * That path still requires the author to be **active staff**. "Changed teams" and
 * "left the company" are different things: without the `callerStaffId` check a
 * terminated author could reach back in and alter — or delete — the record of a
 * review conversation, and termination here is a CSV import flipping `isActive`,
 * which does not revoke their session.
 *
 * A missing note denies with the same message as a forbidden one, so this can't
 * be used to probe which note ids exist. Any action using it must take a
 * `noteId: string` in its input.
 */
export const authorizeReviewNoteMutate: ActionAuthorize = async ({
  user,
  clientInput,
}) => {
  const noteId = (clientInput as { noteId?: unknown }).noteId;
  if (typeof noteId !== "string") deny();

  const [note] = await db
    .select({
      staffId: performanceReviewNote.staffId,
      authorUserId: performanceReviewNote.authorUserId,
    })
    .from(performanceReviewNote)
    .where(eq(performanceReviewNote.id, noteId))
    .limit(1);

  if (!note) deny();

  const { canManage, callerStaffId } = await getReviewNoteAccess(
    user,
    note.staffId,
  );
  if (canManage) return;

  // `callerStaffId` is null for an unlinked or inactive caller (the access read
  // resolves it with `activeOnly`), so this is the author path *and* the
  // still-employed check in one condition.
  if (callerStaffId !== null && note.authorUserId === user.id) return;

  deny();
};
