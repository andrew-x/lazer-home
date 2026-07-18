import "server-only";

import { getCurrentStaffAccess } from "@/actions/staff/getCurrentStaffAccess";

/**
 * Resolve the staff id to stamp as an entry's author from the signed-in user.
 * Reuses the canonical user→staff resolver (never trusts a client-supplied id).
 * Returns null when the user has no staff record — the entry is still recorded,
 * just without author attribution (the `author_staff_id` FK is nullable).
 */
export async function resolveAuthorStaffId(user: {
  id: string;
  email: string;
}): Promise<string | null> {
  const access = await getCurrentStaffAccess(user);
  return "staffId" in access ? access.staffId : null;
}
