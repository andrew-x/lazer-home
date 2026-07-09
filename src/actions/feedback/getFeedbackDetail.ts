import "server-only";

import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/db";
import { feedback, staff } from "@/lib/db/schema";
import type { FeedbackRating } from "@/lib/feedback-rating";
import { userHasPermission } from "@/lib/permissions";

/** Full content of one feedback item, for the detail page. */
export type FeedbackDetail = {
  id: string;
  giverName: string;
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
 * Full feedback content for the given id, or `null` when the caller may not see
 * it (unauthenticated, missing, or not permitted). Full content is visible to
 * the **giver** (they wrote it) and to anyone with **`feedback.review`**
 * (manager/admin). A recipient does NOT get full content here — their limited
 * view comes from `getFeedbackAboutMe`. Returning `null` lets the page
 * `notFound()` without leaking whether the row exists.
 */
export async function getFeedbackDetail(
  id: string,
): Promise<FeedbackDetail | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const giver = alias(staff, "giver");
  const recipient = alias(staff, "recipient");

  const [row] = await db
    .select({
      id: feedback.id,
      fromStaffId: feedback.fromStaffId,
      giverName: giver.name,
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
    .where(eq(feedback.id, id))
    .limit(1);

  if (!row) return null;

  // Reviewers (manager/admin) see everything; otherwise only the giver may.
  if (!userHasPermission(user, { feedback: ["review"] })) {
    const selfStaffId = await getCurrentStaffId();
    if (row.fromStaffId !== selfStaffId) return null;
  }

  const { fromStaffId: _fromStaffId, ...detail } = row;
  return detail;
}
