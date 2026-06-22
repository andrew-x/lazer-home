import type { Metadata } from "next";
import { getUsers } from "@/actions/admin/getUsers";
import { ManageUsers } from "@/components/admin/manage-users";
import { PromoteSelfButton } from "@/components/admin/promote-self-button";
import { isLocalhost } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";

export const metadata: Metadata = { title: "Manage users" };

export default async function ManageUsersPage() {
  const [users, currentUser, local] = await Promise.all([
    getUsers(),
    getCurrentUser(),
    isLocalhost(),
  ]);
  // The admin-API mutations require an admin caller; this local-only escape hatch
  // lets the first developer grant themselves the role to break the chicken-and-egg.
  const canPromoteSelf = local && currentUser != null && !isAdmin(currentUser);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Manage users
          </h2>
          <p className="text-muted-foreground">
            Edit each user's role and ban status inline, then save all changes
            at once. Bans go through Better Auth, so they revoke the user's
            sessions.
          </p>
        </div>
        {canPromoteSelf ? <PromoteSelfButton /> : null}
      </div>

      <ManageUsers users={users} />
    </div>
  );
}
