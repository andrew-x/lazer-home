"use client";

import { IconLayoutSidebar, IconLogout, IconTool } from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark, LogoWordmark } from "@/components/brand/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useSignOut } from "@/hooks/useSignOut";
import { cn } from "@/lib/utils";
import { isActivePath, isActiveSubPath, NAV_ITEMS, type NavItem } from "./nav";

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
  const { toggleSidebar, state } = useSidebar();
  const { signOut, isSigningOut } = useSignOut();

  const visible = visibleNavHrefs && new Set(visibleNavHrefs);
  const navItems = visible
    ? NAV_ITEMS.filter((item) => visible.has(item.href))
    : NAV_ITEMS;
  const collapsed = state === "collapsed";

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
              {navItems.map((item) => (
                <NavMenuItem
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  collapsed={collapsed}
                  visible={visible}
                />
              ))}
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
              onClick={signOut}
              disabled={isSigningOut}
              tooltip="Sign out"
            >
              <IconLogout />
              <span>{isSigningOut ? "Signing out…" : "Sign out"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * A single primary-nav entry. A plain {@link NavItem} renders as one link; an item
 * with a submenu (≥2 visible children) renders its children as an indented
 * {@link SidebarMenuSub} when the sidebar is expanded, and as a flyout dropdown off
 * the icon when it's collapsed to the icon rail (where the indented sub is hidden).
 * With ≤1 visible child (e.g. a user who can't see the sensitive sub-page) it
 * degrades to a plain link so no lone/redundant submenu is shown.
 */
function NavMenuItem({
  item,
  pathname,
  collapsed,
  visible,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  visible: Set<string> | undefined;
}) {
  const active = isActivePath(item.href, pathname);
  const children = (item.children ?? []).filter(
    (child) => !visible || visible.has(child.href),
  );

  // No real submenu → the original single-link entry.
  if (children.length <= 1) {
    return (
      <SidebarMenuItem>
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
  }

  // Collapsed icon rail: the indented sub is hidden, so surface the children in a
  // flyout menu anchored to the icon (opens to the right of the rail).
  if (collapsed) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton isActive={active} tooltip={item.title}>
                <item.icon className={cn(active && "text-primary")} />
                <span>{item.title}</span>
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent side="right" align="start" className="min-w-40">
            {children.map((child) => (
              <DropdownMenuItem
                key={child.href}
                render={<Link href={child.href} />}
              >
                {child.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  }

  // Expanded: the parent links to its section home, children render beneath it.
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={item.title}
        render={<Link href={item.href} />}
      >
        <item.icon className={cn(active && "text-primary")} />
        <span>{item.title}</span>
      </SidebarMenuButton>
      <SidebarMenuSub>
        {children.map((child) => (
          <SidebarMenuSubItem key={child.href}>
            <SidebarMenuSubButton
              isActive={isActiveSubPath(child.href, pathname)}
              render={<Link href={child.href} />}
            >
              <span>{child.title}</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    </SidebarMenuItem>
  );
}
