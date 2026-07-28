import "server-only";

import { and, desc, eq, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { db } from "@/lib/db/db";
import { feedback, staff } from "@/lib/db/schema";
import type { FeedbackRating } from "@/lib/performance/feedback-rating";

/**
 * One feedback item about a direct report, with full content — the same
 * projection a reviewer already gets from `getFeedbackDetail`. The extra
 * `giverId` / `recipientId` are only there to key the list's person filters.
 */
export type FeedbackAboutReportsRow = {
  id: string;
  giverId: string;
  giverName: string;
  recipientId: string;
  recipientName: string;
  rating: FeedbackRating;
  context: string;
  keepDoing: string | null;
  stopDoing: string | null;
  startDoing: string | null;
  other: string | null;
  messageToRecipient: string | null;
  createdAt: Date;
};

/**
 * Feedback about the caller's **direct reports** (`staff.managerId` points at
 * them), for the "Your reports" tab on `/feedback`.
 *
 * Gated on **`feedback.review`** — the same capability `getFeedbackDetail`
 * requires — so every row listed here is one the caller could already open in
 * full at `/feedback/[id]`. This is a browse surface over existing
 * authorization, not a new one: the reporting line only ever *narrows* the
 * result set, it never grants access. Returns `null` when the caller may not see
 * the surface at all, so the page can hide the tab entirely; `[]` means
 * "permitted, nothing to show".
 */
export async function getFeedbackAboutReports(): Promise<
  FeedbackAboutReportsRow[] | null
> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!userHasPermission(user, { feedback: ["review"] })) return null;

  const staffId = await getCurrentStaffId();
  if (!staffId) return null;

  const giver = alias(staff, "giver");
  const recipient = alias(staff, "recipient");

  return db
    .select({
      id: feedback.id,
      giverId: feedback.fromStaffId,
      giverName: giver.name,
      recipientId: feedback.toStaffId,
      recipientName: recipient.name,
      rating: feedback.rating,
      context: feedback.context,
      keepDoing: feedback.keepDoing,
      stopDoing: feedback.stopDoing,
      startDoing: feedback.startDoing,
      other: feedback.other,
      messageToRecipient: feedback.messageToRecipient,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    .innerJoin(giver, eq(feedback.fromStaffId, giver.id))
    .innerJoin(recipient, eq(feedback.toStaffId, recipient.id))
    .where(
      and(
        eq(recipient.managerId, staffId),
        // `managerId` is import-populated with no in-app editor, so a row that
        // points at itself is possible. Without this guard it would hand the
        // caller their own feedback in full — the one thing the recipient tier
        // (`getFeedbackAboutMe`) deliberately withholds.
        ne(recipient.id, staffId),
      ),
    )
    .orderBy(desc(feedback.createdAt));
}
