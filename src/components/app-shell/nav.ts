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
  IconUserStar,
  IconUsers,
} from "@tabler/icons-react";
import type { PermissionCheck } from "@/lib/auth/permissions";
import { COMPENSATION_PLAN_ACCESS } from "@/lib/performance/compensation-plan";
import { BONUS_PAYMENT_WRITE_ACCESS } from "@/lib/staff/staff-bonus";

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
  // Read-only analytics over the workforce. Everything here is aggregate and
  // anonymized; the named, per-person surfaces live under People management.
  {
    title: "Dashboards",
    href: "/dashboards",
    icon: IconChartBar,
    // The section's loosest gate: every role granting `ratings.view` also grants
    // `staff.viewCompensation` (see permissions.ts), so this never hides Levels
    // from someone entitled to it. The parent href redirects to the first
    // dashboard the viewer may see.
    permission: { staff: ["viewCompensation"] },
    children: [
      // Headcount & compensation analytics — same gate as the parent.
      { title: "Compensation", href: "/dashboards/compensation" },
      // Bonus payments paid out, by year — reading a bonus is reading
      // compensation, so the same gate again.
      { title: "Bonuses", href: "/dashboards/bonuses" },
      // Levels are stricter than comp: manager/admin only, not finance.
      {
        title: "Levels",
        href: "/dashboards/levels",
        permission: { ratings: ["view"] },
      },
    ],
  },
  // The write surfaces of performance management: identity-bearing screens where
  // levels are assigned, comp is proposed and payments are recorded.
  {
    title: "People management",
    href: "/people",
    icon: IconUserStar,
    // Not merely the loosest child gate — every child here resolves to exactly
    // {manager, admin} (`ratings.edit` and `staff.edit` have identical role rows,
    // and the two conjunctions add `viewCompensation`, which both already hold).
    // So this gate equals the union of the children rather than over-admitting.
    permission: { ratings: ["edit"] },
    children: [
      // Assigning levels is more sensitive than viewing them → its own gate.
      {
        title: "Edit levels",
        href: "/people/levels",
        permission: { ratings: ["edit"] },
      },
      // Named, per-person compensation proposals — needs both the comp and the
      // ratings-edit capabilities.
      {
        title: "Compensation plans",
        href: "/people/compensation-plans",
        permission: COMPENSATION_PLAN_ACCESS,
      },
      // Recording money against a named individual — comp + staff.edit.
      {
        title: "Bonus payments",
        href: "/people/bonus-payments",
        permission: BONUS_PAYMENT_WRITE_ACCESS,
      },
    ],
  },
  { title: "Peer Feedback", href: "/feedback", icon: IconMessageHeart },
  { title: "Settings", href: "/settings", icon: IconSettings },
];

export function isActivePath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Active check for a submenu sub-item. Uses exact match rather than the prefix
 * match of {@link isActivePath}, so a sub-item at `/people/levels` does not read
 * as active on a deeper sibling that happens to share its prefix.
 */
export function isActiveSubPath(href: string, pathname: string): boolean {
  return pathname === href;
}
