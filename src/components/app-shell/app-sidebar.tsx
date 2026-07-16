"use client";

import { IconLayoutSidebar, IconLogout, IconTool } from "@tabler/icons-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LogoMark, LogoWordmark } from "@/components/brand/logo";
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
import { cn } from "@/lib/utils";
import { isActivePath, NAV_ITEMS } from "./nav";

export function AppSidebar({
  isLocal = false,
  visibleNavHrefs,
}: {
  isLocal?: boolean;
  // Hrefs the current user may see (permission-filtered by the layout). When
  // omitted, every item shows — the icon components stay imported here so they
  // never have to cross the server→client boundary.
  visibleNavHrefs?: string[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { toggleSidebar, state } = useSidebar();
  const [signingOut, setSigningOut] = useState(false);

  const visible = visibleNavHrefs && new Set(visibleNavHrefs);
  const navItems = visible
    ? NAV_ITEMS.filter((item) => visible.has(item.href))
    : NAV_ITEMS;

  async function handleSignOut() {
    setSigningOut(true);
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader>
        <Link href="/" className="flex h-10 items-center overflow-hidden px-2">
          {/* Collapsed: square mark. Expanded: full wordmark (no separate title). */}
          {/* Sizes come from the Image width/height props (not CSS) so Next's
              aspect-ratio check stays happy; the box also can't flash at the
              SVG's intrinsic size during the display swap mid-collapse. */}
          <span className="hidden shrink-0 group-data-[collapsible=icon]:block">
            <LogoMark size={20} />
          </span>
          <LogoWordmark className="shrink-0 group-data-[collapsible=icon]:hidden" />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {navItems.map((item) => {
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
          {/* Admin is a local-only tooling surface — only shown when running locally. */}
          {isLocal && (
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={isActivePath("/admin", pathname)}
                tooltip="Admin"
                render={<Link href="/admin" />}
              >
                <IconTool />
                <span>Admin</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
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
