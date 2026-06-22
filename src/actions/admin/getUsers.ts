import "server-only";

import { asc } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { user } from "@/lib/db/schema";
import { type AppRole, isAppRole } from "@/lib/permissions";

/**
 * One row per application user for the admin "Manage users" table: identity plus
 * the two editable RBAC fields (role, banned). Role is narrowed to a known
 * `AppRole` (unknown/legacy values surface as null); `banned` is normalized from
 * the nullable Better Auth column to a plain boolean. Filtering/sorting happen
 * client-side over this list, so no server-side query params are needed.
 */
export type UserAdminRow = {
  id: string;
  name: string;
  email: string;
  role: AppRole | null;
  banned: boolean;
};

export async function getUsers(): Promise<UserAdminRow[]> {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
    })
    .from(user)
    .orderBy(asc(user.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: isAppRole(r.role) ? r.role : null,
    banned: r.banned ?? false,
  }));
}
