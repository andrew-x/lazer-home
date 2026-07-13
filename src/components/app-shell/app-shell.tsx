"use client";

import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";

export function AppShell({
  children,
  isLocal = false,
}: {
  children: ReactNode;
  isLocal?: boolean;
}) {
  // Start collapsed so the sidebar reads as a floating icon island.
  // The open/close toggle lives inside the sidebar (footer), not here.
  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar isLocal={isLocal} />
      <SidebarInset className="min-w-0">
        <div className="min-w-0 flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
