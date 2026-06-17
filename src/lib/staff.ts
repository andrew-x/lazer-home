import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { staff, staffEmployment } from "@/lib/db/schema";

/**
 * Result of resolving a logged-in user to their staff record.
 * - `ok`         — active staff record with employment info; allow into the app.
 * - `incomplete` — active staff record but no employment rows; a setup error.
 * - `not_setup`  — no active staff record matched; block with "contact Andrew".
 */
export type StaffAccessStatus =
  | { status: "ok"; staffId: string }
  | { status: "incomplete"; staffId: string }
  | { status: "not_setup" };

/**
 * Resolve the staff record for a signed-in user and decide app access.
 *
 * Matching: prefer the staff row already linked by `userId`; otherwise fall
 * back to the active staff row with a matching email and link it (auto-link on
 * first login — staff are synced by email before they ever sign in). The link
 * write is guarded on `userId IS NULL`, so it fires at most once per person and
 * concurrent logins are harmless.
 */
export async function getCurrentStaff(user: {
  id: string;
  email: string;
}): Promise<StaffAccessStatus> {
  // 1. Already linked to this account?
  const [linked] = await db
    .select({ id: staff.id, isActive: staff.isActive })
    .from(staff)
    .where(eq(staff.userId, user.id))
    .limit(1);

  let matched = linked;

  // 2. Not linked yet — find the active staff row by email and link it.
  if (!matched) {
    const [candidate] = await db
      .select({ id: staff.id, isActive: staff.isActive, userId: staff.userId })
      .from(staff)
      .where(and(eq(staff.email, user.email), eq(staff.isActive, true)))
      .limit(1);

    if (candidate && candidate.userId === null) {
      await db
        .update(staff)
        .set({ userId: user.id })
        .where(and(eq(staff.id, candidate.id), isNull(staff.userId)));
      matched = { id: candidate.id, isActive: candidate.isActive };
    }
  }

  // 3. No active staff record → not set up. (Terminated staff have
  //    isActive = false and are correctly blocked here; a rehire is a new row.)
  if (!matched || !matched.isActive) {
    return { status: "not_setup" };
  }

  // 4. Active record but no employment history → flag as a setup error.
  const [employment] = await db
    .select({ id: staffEmployment.id })
    .from(staffEmployment)
    .where(eq(staffEmployment.staffId, matched.id))
    .limit(1);

  if (!employment) {
    return { status: "incomplete", staffId: matched.id };
  }

  return { status: "ok", staffId: matched.id };
}
