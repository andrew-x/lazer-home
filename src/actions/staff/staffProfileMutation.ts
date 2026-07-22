import { revalidatePath } from "next/cache";
import { UserSafeActionError } from "@/lib/core/errors";

/**
 * Revalidate the pages that render a staff member's profile after a mutation:
 * their own `/profile` and the shared `/staff/[id]` detail page. Pass any
 * `extraPaths` for actions that also touch a sub-page (e.g. the skills tab).
 */
export function revalidateStaffProfile(
  staffId: string,
  ...extraPaths: string[]
): void {
  revalidatePath("/profile");
  revalidatePath(`/staff/${staffId}`);
  for (const path of extraPaths) {
    revalidatePath(path);
  }
}

/**
 * Guard for the `db.update(staff)...returning({ id })` pattern: a staff update
 * that matches no row means the profile no longer exists. Throws a user-safe
 * error so the message reaches the client.
 */
export function assertStaffUpdated(rows: { id: string }[]): void {
  if (rows.length === 0) {
    throw new UserSafeActionError("That staff profile no longer exists.");
  }
}
