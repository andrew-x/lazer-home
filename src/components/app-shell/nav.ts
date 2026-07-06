import {
  type Icon,
  IconBuildingSkyscraper,
  IconHome,
  IconSettings,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import { APP_NAME } from "@/lib/constants";

export type NavItem = { title: string; href: string; icon: Icon };

/** Primary nav shown in the sidebar (icons + labels). Extend as domains land. */
export const NAV_ITEMS: NavItem[] = [
  { title: "Home", href: "/", icon: IconHome },
  { title: "My profile", href: "/profile", icon: IconUser },
  { title: "Staff", href: "/staff", icon: IconUsers },
  {
    title: "Companies & Contacts",
    href: "/companies",
    icon: IconBuildingSkyscraper,
  },
  { title: "Settings", href: "/settings", icon: IconSettings },
];

export function isActivePath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function titleForPath(pathname: string): string {
  const match = [...NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => isActivePath(item.href, pathname));
  return match?.title ?? APP_NAME;
}
