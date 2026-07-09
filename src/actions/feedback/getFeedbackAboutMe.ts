import "server-only";

import { desc, eq } from "drizzle-orm";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { db } from "@/lib/db/db";
import { feedback, staff } from "@/lib/db/schema";

/**
 * The recipient's limited view of feedback about them. Deliberately projects
 * ONLY the giver's name, the recipient-visible message, and the date — never the
 * rating, context, or keep/stop/start/other. The projection *is* the privacy
 * boundary: the hidden columns never leave the server.
 */
export type FeedbackAboutMeRow = {
  id: string;
  giverName: string;
  messageToRecipient: string | null;
  createdAt: Date;
};

export async function getFeedbackAboutMe(): Promise<FeedbackAboutMeRow[]> {
  const staffId = await getCurrentStaffId();
  if (!staffId) return [];

  return db
    .select({
      id: feedback.id,
      giverName: staff.name,
      messageToRecipient: feedback.messageToRecipient,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    .innerJoin(staff, eq(feedback.fromStaffId, staff.id))
    .where(eq(feedback.toStaffId, staffId))
    .orderBy(desc(feedback.createdAt));
}
