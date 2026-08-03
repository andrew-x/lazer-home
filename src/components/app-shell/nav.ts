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
  IconTargetArrow,
  IconUser,
  IconUserStar,
  IconUsers,
} from "@tabler/icons-react";
import type { PermissionCheck } from "@/lib/auth/permissions";
import { COMPENSATION_PLAN_ACCESS } from "@/lib/performance/compensation-plan";
import { PROFILE_COMPLETENESS_ACCESS } from "@/lib/staff/profile-completeness";
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
  { title: "Peer Feedback", href: "/feedback", icon: IconMessageHeart },
  { title: "Companies", href: "/companies", icon: IconBuildingSkyscraper },
  { title: "Contacts", href: "/contacts", icon: IconAddressBook },
  { title: "Opportunities", href: "/opportunities", icon: IconTargetArrow },
  { title: "Projects", href: "/projects", icon: IconBriefcase },
  { title: "Allocations", href: "/allocations", icon: IconCalendarStats },
  { title: "Timesheets", href: "/timesheets", icon: IconClock },
  // Read-only reporting over the workforce. The dividing line against People
  // management is read vs. write, not aggregate vs. per-person: most of what's
  // here is aggregate, but Profile completeness is a named per-person read and
  // still belongs on this side, because nothing in it writes.
  {
    title: "Reporting",
    href: "/reporting",
    icon: IconChartBar,
    // Ungated, because Utilization is: it re-aggregates the allocation and leave
    // data the planner already shows everyone. Every other child carries its own
    // gate, so the section stays as loose as its loosest child rather than hiding
    // an open page behind a capability. The parent href redirects to the first
    // report the viewer may see.
    children: [
      // Capacity, staffing and logged time — open to every signed-in user; the
      // one sensitive series (other people's timesheets) is withheld in the read.
      { title: "Utilization", href: "/reporting/utilization" },
      // Headcount & compensation reporting.
      {
        title: "Compensation",
        href: "/reporting/compensation",
        permission: { staff: ["viewCompensation"] },
      },
      // Bonus payments paid out, by year — reading a bonus is reading
      // compensation, so the same gate again.
      {
        title: "Bonuses",
        href: "/reporting/bonuses",
        permission: { staff: ["viewCompensation"] },
      },
      // Levels are stricter than comp: manager/admin only, not finance.
      {
        title: "Levels",
        href: "/reporting/levels",
        permission: { ratings: ["view"] },
      },
      // Who has and hasn't filled out their profile. Named per-person, but the
      // only thing disclosed is whether a field is populated — so it takes the
      // plain `staff.edit` gate held by whoever would chase them.
      {
        title: "Profile completeness",
        href: "/reporting/profile-completeness",
        permission: PROFILE_COMPLETENESS_ACCESS,
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
