import "server-only";

import { desc, eq } from "drizzle-orm";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { db } from "@/lib/db/db";
import { feedback, staff } from "@/lib/db/schema";
import type { FeedbackRating } from "@/lib/performance/feedback-rating";

/**
 * The feedback the caller has authored, with full content (own-scoped — you
 * always see the feedback you wrote, no capability needed). The `/feedback` list
 * shows a summary and opens the full item in a dialog, so everything needed for
 * both is returned here.
 */
export type FeedbackIGaveRow = {
  id: string;
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

export async function getFeedbackIGave(): Promise<FeedbackIGaveRow[]> {
  const staffId = await getCurrentStaffId();
  if (!staffId) return [];

  return db
    .select({
      id: feedback.id,
      recipientName: staff.name,
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
    .innerJoin(staff, eq(feedback.toStaffId, staff.id))
    .where(eq(feedback.fromStaffId, staffId))
    .orderBy(desc(feedback.createdAt));
}
