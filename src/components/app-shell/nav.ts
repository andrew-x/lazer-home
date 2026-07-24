import {
  type Icon,
  IconAddressBook,
  IconBriefcase,
  IconBuildingSkyscraper,
  IconCalendarStats,
  IconChartBar,
  IconClock,
  IconHome,
  IconMessageHeart,
  IconSettings,
  IconTargetArrow,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import type { PermissionCheck } from "@/lib/auth/permissions";

/**
 * A sub-entry under a {@link NavItem}. Has no icon of its own — it renders
 * indented beneath its parent (expanded sidebar) or inside the parent's flyout
 * menu (collapsed icon rail). `permission` gates it independently of the parent.
 */
export type NavSubItem = {
  title: string;
  href: string;
  permission?: PermissionCheck;
};

/**
 * A sidebar entry. `permission`, when set, gates visibility: the layout evaluates
 * it against the current user and only shows the item to those who hold the
 * capability (see {@link visibleNavHrefs} in the `(app)` layout). `children`, when
 * present, turns the entry into a submenu (rendered by the sidebar).
 */
export type NavItem = {
  title: string;
  href: string;
  icon: Icon;
  permission?: PermissionCheck;
  children?: NavSubItem[];
};

/** Primary nav shown in the sidebar (icons + labels). Extend as domains land. */
export const NAV_ITEMS: NavItem[] = [
  { title: "Home", href: "/", icon: IconHome },
  { title: "My profile", href: "/profile", icon: IconUser },
  { title: "Staff", href: "/staff", icon: IconUsers },
  { title: "Companies", href: "/companies", icon: IconBuildingSkyscraper },
  { title: "Contacts", href: "/contacts", icon: IconAddressBook },
  { title: "Opportunities", href: "/opportunities", icon: IconTargetArrow },
  { title: "Projects", href: "/projects", icon: IconBriefcase },
  { title: "Allocations", href: "/allocations", icon: IconCalendarStats },
  { title: "Timesheets", href: "/timesheets", icon: IconClock },
  {
    title: "Performance",
    href: "/performance",
    icon: IconChartBar,
    // Surfaces aggregate compensation → gate on the comp-viewing capability.
    permission: { staff: ["viewCompensation"] },
    children: [
      // Same page as the parent, named explicitly so the submenu reads as a pair.
      { title: "Dashboard", href: "/performance" },
      // Assigning levels is more sensitive than viewing them → its own gate.
      {
        title: "Edit levels",
        href: "/performance/levels/edit",
        permission: { ratings: ["edit"] },
      },
    ],
  },
  { title: "Feedback", href: "/feedback", icon: IconMessageHeart },
  { title: "Settings", href: "/settings", icon: IconSettings },
];

export function isActivePath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Active check for a submenu sub-item. Uses exact match rather than the prefix
 * match of {@link isActivePath}, so a "Dashboard" sub-item at `/performance` does
 * not read as active on `/performance/levels/edit` (its sibling's prefix).
 */
export function isActiveSubPath(href: string, pathname: string): boolean {
  return pathname === href;
}
