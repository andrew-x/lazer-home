import { revalidatePath } from "next/cache";
import { revalidateStaffProfile } from "@/actions/staff/staffProfileMutation";
import { UserSafeActionError } from "@/lib/core/errors";

/** The dashboard and the entry screen both read every payment. */
const BONUS_READER_PATHS = ["/dashboards/bonuses", "/people/bonus-payments"];

/**
 * Revalidate everything that renders bonus payments after a mutation: the bonus
 * dashboard, the entry screen, and the affected person's profile (their history
 * feed gains or loses an entry).
 *
 * Shared by all three bonus actions so a new reader surface is wired up in one
 * place rather than in three that drift.
 */
export function revalidateBonusPayment(staffId: string): void {
  for (const path of BONUS_READER_PATHS) revalidatePath(path);
  revalidateStaffProfile(staffId);
}

/**
 * Guard for the `returning({ staffId })` pattern: a payment update/delete that
 * matched no row means someone else already removed it. Throws a user-safe error
 * and returns the owning staff id for revalidation.
 */
export function assertBonusPaymentTouched(rows: { staffId: string }[]): string {
  const row = rows[0];
  if (!row) {
    throw new UserSafeActionError("That bonus payment no longer exists.");
  }
  return row.staffId;
}
