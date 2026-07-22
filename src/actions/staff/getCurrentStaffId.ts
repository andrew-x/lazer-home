import "server-only";

import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/auth";
import { ownStaffId } from "./ownStaffId";

/**
 * The signed-in user's linked staff id, or null when unauthenticated or no staff
 * record is linked to the account. The current-user convenience wrapper around
 * {@link ownStaffId}, reused across the timesheet / feedback / PTO reads and the
 * profile-related pages that need the caller's own staff id.
 *
 * Wrapped in `React.cache` so the several callers within a single render share
 * one lookup per request.
 */
export const getCurrentStaffId = cache(async (): Promise<string | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  return ownStaffId(user.id);
});
