import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";
import { z } from "zod";
import { UserSafeActionError } from "@/lib/errors";

/**
 * RBAC — the single source of truth for permissions and roles.
 *
 * This file defines every capability in the system and which roles grant it.
 * The action layer (`src/lib/action.ts`), the staff edit guard, and the PTO read
 * all enforce through the helpers here, so there is exactly ONE place where the
 * access-control logic lives. The role → permission contract is asserted by
 * `permissions.test.ts` and audited by `/audit-rbac`.
 *
 * Foundation: Better Auth's access-control system (the `admin` plugin). Roles are
 * stored in `user.role`; validity is enforced at the app layer by `roleSchema`
 * (Better Auth owns `auth-schema.ts`, so the column stays `text()`).
 */

/**
 * The statement: every resource and the actions defined on it. Better Auth's
 * `defaultStatements` (user/session admin-plugin perms) are merged in so the
 * admin role keeps its built-in user-management capabilities.
 */
export const statement = {
  ...defaultStatements,
  staff: ["edit", "viewCompensation"], // edit another staff member's profile; view others' compensation
  pto: ["review"], // view aggregated PTO summaries of other staff
  crm: ["edit"], // add/edit CRM companies, contacts & opportunities (reads are open)
  projects: ["edit"], // add/edit projects & their staffing (reads are open)
} as const;

export const ac = createAccessControl(statement);

/**
 * Roles → permissions. THIS TABLE IS THE CONTRACT. Keep it in lockstep with
 * `permissions.test.ts` and the design spec; changing it must be deliberate.
 */
export const roles = {
  user: ac.newRole({}),
  "delivery-manager": ac.newRole({ projects: ["edit"] }),
  finance: ac.newRole({ staff: ["viewCompensation"] }),
  sales: ac.newRole({ crm: ["edit"] }),
  manager: ac.newRole({
    staff: ["edit", "viewCompensation"],
    pto: ["review"],
    crm: ["edit"],
    projects: ["edit"],
  }),
  // Admin keeps the business perms AND the Better Auth admin-plugin perms.
  admin: ac.newRole({
    staff: ["edit", "viewCompensation"],
    pto: ["review"],
    crm: ["edit"],
    projects: ["edit"],
    ...adminAc.statements,
  }),
} as const;

export type AppRole = keyof typeof roles;

/** All role slugs as a tuple, for Zod validation of the `user.role` column. */
export const ROLE_SLUGS = Object.keys(roles) as [AppRole, ...AppRole[]];

/** Validate a role value anywhere a role is set/accepted. */
export const roleSchema = z.enum(ROLE_SLUGS);

/** New users get this role (mirrors `admin({ defaultRole })` in auth.ts). */
export const DEFAULT_ROLE: AppRole = "user";

/**
 * A permission request: a subset of `statement`. Derived directly from
 * `statement` so adding a resource/action there immediately makes it gateable
 * here — no parallel list to keep in sync. Used by `metadata.permission` on
 * actions and by the imperative helpers below.
 */
export type PermissionCheck = {
  [Resource in keyof typeof statement]?: (typeof statement)[Resource][number][];
};

/** The minimal user shape these helpers need — just the role. */
type RoleBearer = { role?: string | null };

/** Narrow an arbitrary role string to a known app role. */
export function isAppRole(role: string | null | undefined): role is AppRole {
  return role != null && Object.hasOwn(roles, role);
}

/**
 * True when the user holds the most-privileged `admin` role. The one place the
 * `"admin"` literal lives for coarse role gating (e.g. `checkAuth("admin")`), so
 * access-control logic stays in this module. Prefer `userHasPermission` for
 * specific capabilities.
 */
export function isAdmin(user: RoleBearer): boolean {
  return user.role === "admin";
}

/**
 * Does this user have the requested permission(s)? Pure and synchronous — driven
 * entirely by the user's role. Unknown/null roles fall back to `DEFAULT_ROLE`
 * (least privilege), so a misconfigured role can never accidentally grant access.
 */
export function userHasPermission(
  user: RoleBearer,
  permissions: PermissionCheck,
): boolean {
  const role = isAppRole(user.role) ? user.role : DEFAULT_ROLE;
  return roles[role].authorize(permissions).success;
}

/**
 * Assert a permission, throwing a user-safe error when denied. Use in action
 * bodies and server-component reads for row-level / capability gating.
 */
export function requirePermission(
  user: RoleBearer,
  permissions: PermissionCheck,
): void {
  if (!userHasPermission(user, permissions)) {
    throw new UserSafeActionError("You don't have permission to do that.");
  }
}
