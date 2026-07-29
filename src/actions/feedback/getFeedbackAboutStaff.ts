import "server-only";

import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  type FeedbackAboutMeRow,
  getFeedbackAboutMe,
} from "@/actions/feedback/getFeedbackAboutMe";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { db } from "@/lib/db/db";
import { feedback, staff } from "@/lib/db/schema";
import type { FeedbackRating } from "@/lib/performance/feedback-rating";

/** One feedback item about this person, in full — the reviewer's projection. */
export type StaffFeedbackFullRow = {
  id: string;
  giverName: string;
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
 * Which of the two privacy tiers this viewer gets. The tag is what the panel
 * keys its copy off — a reviewer is told out loud that they see more than the
 * person does.
 */
export type StaffFeedbackView =
  | { tier: "recipient"; rows: FeedbackAboutMeRow[] }
  | { tier: "full"; rows: StaffFeedbackFullRow[] };

/**
 * Peer feedback received by one staff member, for the **Peer feedback tab** on
 * their profile. Two tiers, in this order — the order is the point:
 *
 * 1. **Your own profile → the limited recipient projection**, even if you hold
 *    `feedback.review`. ADR 0023 accepts that a reviewer can read their own
 *    feedback in full via `/feedback/[id]`; this surface deliberately does not
 *    widen that gap, so the self branch is checked first.
 * 2. **Someone else's profile + `feedback.review` → full content.** Every row is
 *    one the holder could already open at `/feedback/[id]`, so this adds
 *    *discovery*, not access — the per-person form of the browse list ADR 0047
 *    left deferred. No new capability, no matrix change.
 *
 * Anyone else gets **`null`** and the profile renders no tab, so its presence
 * never signals that feedback exists.
 */
export async function getFeedbackAboutStaff(
  staffId: string,
): Promise<StaffFeedbackView | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const callerStaffId = await getCurrentStaffId();
  if (callerStaffId === staffId) {
    return { tier: "recipient", rows: await getFeedbackAboutMe() };
  }

  if (!userHasPermission(user, { feedback: ["review"] })) return null;

  const giver = alias(staff, "giver");

  const rows = await db
    .select({
      id: feedback.id,
      giverName: giver.name,
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
    .where(eq(feedback.toStaffId, staffId))
    .orderBy(desc(feedback.createdAt));

  return { tier: "full", rows };
}
