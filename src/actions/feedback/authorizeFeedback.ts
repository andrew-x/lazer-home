import "server-only";

import { and, eq } from "drizzle-orm";
import type { ActionAuthorize } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";

/**
 * Can this user leave feedback about the target staff member?
 *
 * Rule: the caller must have an **active** linked staff record, the target must
 * be a distinct **active** staff member, and you can't leave feedback about
 * yourself. Giving feedback is open to everyone (no capability) — this is the
 * boundary. Mirrors the shape of `canEditStaff` (ADR 0014).
 */
export async function canGiveFeedback(
  user: { id: string },
  targetStaffId: string,
): Promise<boolean> {
  // Caller must be active staff.
  const [caller] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.userId, user.id), eq(staff.isActive, true)))
    .limit(1);
  if (!caller) return false;

  // No self-feedback.
  if (caller.id === targetStaffId) return false;

  // Target must be active staff.
  const [target] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.id, targetStaffId), eq(staff.isActive, true)))
    .limit(1);
  return Boolean(target);
}

/**
 * Action `authorize` hook for leaving feedback: gates on the input's `toStaffId`.
 * Wire with `metadata({ authorize: authorizeFeedbackCreate })`. Any action using
 * it must take a `toStaffId: string` in its input.
 */
export const authorizeFeedbackCreate: ActionAuthorize = async ({
  user,
  clientInput,
}) => {
  const toStaffId = (clientInput as { toStaffId?: unknown }).toStaffId;
  if (
    typeof toStaffId !== "string" ||
    !(await canGiveFeedback(user, toStaffId))
  ) {
    throw new UserSafeActionError("You can't leave feedback for that person.");
  }
};
