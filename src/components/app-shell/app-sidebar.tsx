"use client";

import { IconLayoutSidebar, IconLogout } from "@tabler/icons-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LogoMark } from "@/components/brand/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { isActivePath, NAV_ITEMS } from "./nav";

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { toggleSidebar, state } = useSidebar();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader>
        <Link
          href="/"
          className="flex h-10 items-center gap-2 overflow-hidden px-2"
        >
          <LogoMark className="shrink-0" />
          <span className="truncate font-heading text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            {APP_NAME}
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {NAV_ITEMS.map((item) => {
                const active = isActivePath(item.href, pathname);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.title}
                      render={<Link href={item.href} />}
                    >
                      {/* Indigo only on the active item's icon — accent used sparingly. */}
                      <item.icon className={cn(active && "text-primary")} />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu className="gap-2">
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={toggleSidebar}
              tooltip={
                state === "collapsed" ? "Expand sidebar" : "Collapse sidebar"
              }
            >
              <IconLayoutSidebar />
              <span>{state === "collapsed" ? "Expand" : "Collapse"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleSignOut}
              disabled={signingOut}
              tooltip="Sign out"
            >
              <IconLogout />
              <span>{signingOut ? "Signing out…" : "Sign out"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
