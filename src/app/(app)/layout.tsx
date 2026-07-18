import { redirect } from "next/navigation";
import { getCurrentStaffAccess } from "@/actions/staff/getCurrentStaffAccess";
import { AppShell } from "@/components/app-shell/app-shell";
import { NAV_ITEMS } from "@/components/app-shell/nav";
import { isLocalhost } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { userHasPermission } from "@/lib/permissions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Gate on an active staff record (see /profile-setup for the block screen).
  const staffAccess = await getCurrentStaffAccess(user);
  if (staffAccess.status !== "ok") redirect("/profile-setup");

  // Permission-gated nav items are hidden from users who lack the capability.
  // Evaluated here (we have the user) and passed to the client sidebar as plain
  // hrefs, so the icon components never cross the server→client boundary.
  const visibleNavHrefs = NAV_ITEMS.filter(
    (item) => !item.permission || userHasPermission(user, item.permission),
  ).map((item) => item.href);

  return (
    <AppShell isLocal={await isLocalhost()} visibleNavHrefs={visibleNavHrefs}>
      {children}
    </AppShell>
  );
}
