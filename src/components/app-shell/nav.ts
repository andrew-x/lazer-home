import {
  type Icon,
  IconAddressBook,
  IconBriefcase,
  IconBuildingSkyscraper,
  IconChartBar,
  IconClock,
  IconHome,
  IconMessageHeart,
  IconSettings,
  IconTargetArrow,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import type { PermissionCheck } from "@/lib/permissions";

/**
 * A sidebar entry. `permission`, when set, gates visibility: the layout evaluates
 * it against the current user and only shows the item to those who hold the
 * capability (see {@link visibleNavHrefs} in the `(app)` layout).
 */
export type NavItem = {
  title: string;
  href: string;
  icon: Icon;
  permission?: PermissionCheck;
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
  { title: "Timesheets", href: "/timesheets", icon: IconClock },
  {
    title: "Performance",
    href: "/performance",
    icon: IconChartBar,
    // Surfaces aggregate compensation → gate on the comp-viewing capability.
    permission: { staff: ["viewCompensation"] },
  },
  { title: "Feedback", href: "/feedback", icon: IconMessageHeart },
  { title: "Settings", href: "/settings", icon: IconSettings },
];

export function isActivePath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
