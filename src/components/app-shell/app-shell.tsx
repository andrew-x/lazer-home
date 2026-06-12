"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, type SessionUser } from "./app-sidebar";
import { titleForPath } from "./nav";

export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  const pathname = usePathname();

  // Start collapsed so the sidebar reads as a floating icon island.
  // The open/close toggle lives inside the sidebar (footer), not here.
  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar user={user} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center border-b px-4 md:px-6">
          <h1 className="font-heading text-sm font-medium">
            {titleForPath(pathname)}
          </h1>
        </header>
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
