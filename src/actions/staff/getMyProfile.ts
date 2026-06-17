import "server-only";

import { getCurrentStaffId } from "./getCurrentStaffId";
import { getStaffProfile, type StaffProfile } from "./getStaffProfile";

/** Back-compat alias — the profile shape is identical for self and others. */
export type MyProfile = StaffProfile;

/**
 * The signed-in user's own profile for SSR. Resolves the current staff id and
 * delegates to {@link getStaffProfile}. Returns null when unauthenticated or
 * unlinked.
 */
export async function getMyProfile(): Promise<MyProfile | null> {
  const staffId = await getCurrentStaffId();
  return staffId ? getStaffProfile(staffId) : null;
}
