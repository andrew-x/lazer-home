import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { getReviewNoteAccess } from "@/actions/performance/reviewNoteAccess";
import { getCurrentUser } from "@/lib/auth/auth";
import { db } from "@/lib/db/db";
import { performanceReviewNote, user as userTable } from "@/lib/db/schema";
import type { PerformanceReviewNoteStatus } from "@/lib/performance/review-note";

/** One review note, as its reader is allowed to see it. */
export type ReviewNoteRow = {
  id: string;
  noteDate: string;
  title: string | null;
  body: string;
  status: PerformanceReviewNoteStatus;
  sharedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Display name of the manager who wrote it (null if their account is gone). */
  authorName: string | null;
  /** Whether THIS reader may edit / share / delete this note. */
  canManage: boolean;
};

export type StaffReviewNotesView = {
  /** Whether this reader may start a new note about the person. */
  canCreate: boolean;
  /** Whether this reader is the person the notes are about. */
  isSubject: boolean;
  notes: ReviewNoteRow[];
};

/**
 * Review notes about one staff member, projected for the caller.
 *
 * Three readers, and the projection is the boundary:
 *   - **manager / admin** (`canManage`) — every note, drafts included;
 *   - **the subject** — `SHARED` notes only, so a draft never leaks;
 *   - **an author** who is no longer the person's manager — only their own notes.
 *
 * Returns **`null`** when the caller is none of those, so the profile renders no
 * tab at all; `[]` means "permitted, nothing written yet". Keeping those distinct
 * matters: a tab that appeared for everyone would itself disclose that notes
 * exist.
 *
 * Authorization is the **reporting line**, not a capability — see
 * `reviewNoteAccess.ts` for why that is deliberate and what it costs.
 */
export async function getStaffReviewNotes(
  staffId: string,
): Promise<StaffReviewNotesView | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const { isSubject, canManage, callerStaffId } = await getReviewNoteAccess(
    user,
    staffId,
  );

  // Neither the subject nor a manager: the only rows they could be entitled to
  // are ones they authored, and that path requires them to still be active staff
  // (see `authorizeReviewNoteMutate`). No active staff row ⇒ no surface at all,
  // without even running the query.
  if (!canManage && !isSubject && callerStaffId === null) return null;

  const columns = {
    id: performanceReviewNote.id,
    noteDate: performanceReviewNote.noteDate,
    title: performanceReviewNote.title,
    body: performanceReviewNote.body,
    status: performanceReviewNote.status,
    sharedAt: performanceReviewNote.sharedAt,
    createdAt: performanceReviewNote.createdAt,
    updatedAt: performanceReviewNote.updatedAt,
    authorName: userTable.name,
    authorUserId: performanceReviewNote.authorUserId,
  };

  const rows = await db
    .select(columns)
    .from(performanceReviewNote)
    .leftJoin(userTable, eq(performanceReviewNote.authorUserId, userTable.id))
    .where(
      canManage
        ? eq(performanceReviewNote.staffId, staffId)
        : isSubject
          ? // The subject sees shared notes only — drafts stay with the author.
            and(
              eq(performanceReviewNote.staffId, staffId),
              eq(performanceReviewNote.status, "SHARED"),
            )
          : // Neither: the only rows they could be entitled to are their own
            // (an ex-manager who wrote notes before moving teams).
            and(
              eq(performanceReviewNote.staffId, staffId),
              eq(performanceReviewNote.authorUserId, user.id),
            ),
    )
    .orderBy(
      desc(performanceReviewNote.noteDate),
      desc(performanceReviewNote.createdAt),
    );

  // Not the subject, not a manager, and nothing of their own here — no surface.
  if (!canManage && !isSubject && rows.length === 0) return null;

  return {
    canCreate: canManage,
    isSubject,
    notes: rows.map(({ authorUserId, ...row }) => ({
      ...row,
      // The author of a note may always fix or delete it (see the mutate hook).
      canManage: canManage || authorUserId === user.id,
    })),
  };
}
