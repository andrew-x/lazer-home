import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentStaff } from "@/lib/staff";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Gate on an active staff record (see /profile-setup for the block screen).
  const staffAccess = await getCurrentStaff(user);
  if (staffAccess.status !== "ok") redirect("/profile-setup");

  return <AppShell>{children}</AppShell>;
}
