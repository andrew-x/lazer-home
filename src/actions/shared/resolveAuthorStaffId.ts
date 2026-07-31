import "server-only";

import { getCurrentStaffAccess } from "@/actions/staff/getCurrentStaffAccess";

/**
 * Resolve the staff id to stamp as a record's author from the signed-in user.
 * Reuses the canonical user→staff resolver (never trusts a client-supplied id).
 * Returns null when the user has no staff record — the record is still written,
 * just without author attribution (every `authorStaffId` FK is nullable).
 *
 * Domain-agnostic, hence `shared/`: the CRM entry logs and tasks stamp authors
 * this way, and so do project delivery notes.
 */
export async function resolveAuthorStaffId(user: {
  id: string;
  email: string;
}): Promise<string | null> {
  const access = await getCurrentStaffAccess(user);
  return "staffId" in access ? access.staffId : null;
}
