import {
  type Icon,
  IconAddressBook,
  IconBriefcase,
  IconBuildingSkyscraper,
  IconHome,
  IconMessageHeart,
  IconSettings,
  IconTargetArrow,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
export type NavItem = { title: string; href: string; icon: Icon };

/** Primary nav shown in the sidebar (icons + labels). Extend as domains land. */
export const NAV_ITEMS: NavItem[] = [
  { title: "Home", href: "/", icon: IconHome },
  { title: "My profile", href: "/profile", icon: IconUser },
  { title: "Staff", href: "/staff", icon: IconUsers },
  { title: "Companies", href: "/companies", icon: IconBuildingSkyscraper },
  { title: "Contacts", href: "/contacts", icon: IconAddressBook },
  { title: "Opportunities", href: "/opportunities", icon: IconTargetArrow },
  { title: "Projects", href: "/projects", icon: IconBriefcase },
  { title: "Feedback", href: "/feedback", icon: IconMessageHeart },
  { title: "Settings", href: "/settings", icon: IconSettings },
];

export function isActivePath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
