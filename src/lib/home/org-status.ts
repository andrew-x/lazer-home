/**
 * "Lazer Status" — the home dashboard's **point-in-time** view of the whole
 * consultancy. A pure, client-importable module (no `db`/drizzle, no React) over
 * the same `{ staff, roles, openRoles, timeOff }` the allocations planner reads
 * (`getAllocationsGrid`). See docs/domains/allocations.md.
 *
 * ## Point in time, from the plan — not year to date, not from timesheets
 *
 * The org half of this page answers *right now, how much of the bench is working?*
 * That is a **staffing-plan** question, so every figure here derives from
 * `project_roles` as of today. It deliberately does **not** use timesheets:
 * submitted-hours coverage is partial, and a plan-vs-actual figure would read
 * thin timesheet adoption as low utilization.
 *
 * This sits opposite "Your Status", which is **year to date** from submitted
 * timesheets (`getStaffUtilization`). The two time bases are the design, not an
 * inconsistency to reconcile: a person's own utilization is a cumulative fact
 * about their year, while the organization's is an instantaneous fact about today.
 * Every surface built on either **must** name its window — the word "utilization"
 * alone is ambiguous on this page. `/dashboards/utilization` is a third thing
 * again: plan *reconciled against* actuals over a chosen range (ADR 0062).
 *
 * ## The payload is a disclosure boundary
 *
 * {@link buildOrgStatus} exists partly to be a whitelist. Its output is the prop
 * of a Client Component, so **everything it returns is serialized into the page
 * HTML for every viewer.** `AllocationStaffRow` carries `allocationNotes` —
 * manager-only staffing commentary gated on `staff.edit` inside the read — and it
 * must never reach this payload. Fields are therefore copied one at a time, never
 * spread: a spread would silently ship the next sensitive column somebody adds
 * upstream. Time-off `type` is already nulled by the read for viewers without
 * `pto.review`, so it passes through untouched and is never re-derived here.
 *
 * Nothing else here is a new disclosure: names, roles, lines of business, project
 * names and allocation spans are all already public via `/allocations`.
 */

import type {
  AllocationRoleRow,
  AllocationStaffRow,
  AllocationTimeOff,
  OpenRoleRow,
} from "@/actions/allocations/getAllocationsGrid";
import type { UpcomingLeave, WeekLoad } from "@/lib/allocations/availability";
import {
  AVAILABLE_THRESHOLD_PERCENT,
  availabilityWeekStarts,
  buildAvailability,
  buildUpcomingTimeOff,
  summarizeWeeks,
} from "@/lib/allocations/availability";
import { groupPerKey } from "@/lib/core/collections";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import type { ProjectRoleType } from "@/lib/projects/project-role-type";
import type { EmploymentType, Role } from "@/lib/staff/staff-enums";
import { addDays } from "@/lib/timesheets/timesheet-week";

/** How far ahead the upcoming-roles panel looks, in days. */
export const UPCOMING_ROLES_HORIZON_DAYS = 28;

/**
 * One person in the population, carrying everything the client needs to re-derive
 * every figure after filtering. Deliberately **not** pre-aggregated: the filters
 * are client-side, so totals have to be recomputable there.
 */
export type OrgPerson = {
  staffId: string;
  name: string;
  /** The person's discipline — the dimension the staffing table breaks down by. */
  role: Role | null;
  /**
   * The person's **home** line of business, from their latest employment row. This
   * is what the section's filter matches, on every widget: "Fintech" means the
   * Fintech team, regardless of which projects they were lent to.
   */
  lineOfBusiness: LineOfBusiness | null;
  employmentType: EmploymentType | null;
  /** Per-week load, positionally aligned with {@link OrgStatus.weekStarts}. */
  weeks: WeekLoad[];
  /** They hold tentative work in the window but nothing confirmed. */
  tentativeOnly: boolean;
  /**
   * Holds at least one **confirmed** role spanning today. Tentative work does not
   * count — it's a plan, not a commitment (the same rule behind
   * `latestConfirmedEnd` and the planner's default sort).
   *
   * Somebody on approved leave today is still "staffed": this measures whether the
   * plan has them working, not whether they are at their desk. Availability, right
   * beside it, is where leave nets capacity out.
   */
  staffedToday: boolean;
};

/** A role starting or ending inside the horizon. */
export type OrgUpcomingRole = {
  roleId: string;
  projectId: string;
  projectName: string;
  roleType: ProjectRoleType;
  /** The line of business of the *work*. */
  roleLineOfBusiness: LineOfBusiness;
  /** Null for an open position — nobody is in it yet. */
  staffId: string | null;
  staffName: string | null;
  /** The holder's home line of business; null when the role is unfilled. */
  personLineOfBusiness: LineOfBusiness | null;
  startDate: string;
  endDate: string;
  /** Which end of the span falls inside the horizon. */
  kind: "starting" | "ending";
  /** Days until that date; 0 means today. */
  inDays: number;
};

/** Somebody working outside their own line of business, right now. */
export type OrgBorrowed = {
  staffId: string;
  name: string;
  /** Where the person belongs. */
  homeLineOfBusiness: LineOfBusiness;
  projectId: string;
  projectName: string;
  /** The line of business they've been lent to. */
  roleLineOfBusiness: LineOfBusiness;
  roleType: ProjectRoleType;
  endDate: string;
};

/** An upcoming absence, plus the home line of business the filter matches on. */
export type OrgLeave = UpcomingLeave & {
  personLineOfBusiness: LineOfBusiness | null;
};

/** The whole serialized payload the client section is driven by. */
export type OrgStatus = {
  /** ISO Mondays, positionally aligned with every person's `weeks`. */
  weekStarts: string[];
  people: OrgPerson[];
  upcomingRoles: OrgUpcomingRole[];
  borrowed: OrgBorrowed[];
  leave: OrgLeave[];
  /** Today, so the UI can label the figures with the instant they describe. */
  today: string;
};

/** A staffing figure kept alongside its parts, so the UI can show the working. */
export type StaffingRate = {
  staffed: number;
  headcount: number;
  /** `staffed / headcount`, or null when there's nobody to divide by. */
  rate: number | null;
};

/**
 * One discipline's row in the staffing table. `OTHER` catches anyone in the billable
 * population who isn't in a delivery discipline, so the rows always account for the
 * same people as the overall figure.
 */
export type RoleStaffing = StaffingRate & { role: Role | "OTHER" };

/** The staffing panel's whole model. */
export type StaffingSummary = StaffingRate & {
  /** People on `FULL_TIME` employment — the normalized denominator. */
  fullTimeCount: number;
  /**
   * `staffed / fullTimeCount`. **Deliberately uncapped:** staffed hourly people
   * measured against a full-time denominator can exceed 100%, and that excess is
   * the signal — it means the org is delivering more than its salaried base could.
   * Null when nobody is full time, never 0.
   */
  normalizedRate: number | null;
  byRole: RoleStaffing[];
};

/** Whole days between two ISO dates, computed in UTC to sidestep DST. */
function daysBetween(from: string, to: string): number {
  const dayNumber = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  };
  return dayNumber(to) - dayNumber(from);
}

function rateOf(staffed: number, headcount: number): StaffingRate {
  return {
    staffed,
    headcount,
    rate: headcount > 0 ? staffed / headcount : null,
  };
}

/** Holds a confirmed role whose span contains `today`. */
function isStaffedOn(
  personRoles: readonly AllocationRoleRow[],
  today: string,
): boolean {
  return personRoles.some(
    (role) =>
      role.status === "confirmed" &&
      role.startDate <= today &&
      role.endDate >= today,
  );
}

/**
 * Fold the planner's raw grid into the client payload.
 *
 * The population is `isBillable === true`, identical to `buildAvailability` — one
 * definition of "the bench" shared by every figure on the section, so the
 * staffing rate and the availability strip can't disagree about who counts.
 *
 * `buildAvailability` is reused rather than reimplemented, which is what keeps the
 * week loads here and the planner's own capacity meter on one arithmetic.
 */
export function buildOrgStatus(
  staff: readonly AllocationStaffRow[],
  roles: readonly AllocationRoleRow[],
  openRoles: readonly OpenRoleRow[],
  timeOff: readonly AllocationTimeOff[],
  today: string,
  fromWeek: string,
  horizonDays: number = UPCOMING_ROLES_HORIZON_DAYS,
): OrgStatus {
  const { people: availability } = buildAvailability(
    staff,
    roles,
    timeOff,
    fromWeek,
  );
  const rolesByStaff = groupPerKey(roles, (role) => role.staffId);
  const staffById = new Map(staff.map((person) => [person.id, person]));

  // Field-by-field, never a spread — see the disclosure note at the top of this
  // module. `allocationNotes` and `skills` stay on the server.
  const people: OrgPerson[] = availability.map((person) => ({
    staffId: person.staffId,
    name: person.name,
    role: person.role,
    lineOfBusiness: person.lineOfBusiness,
    employmentType: person.employmentType,
    weeks: person.weeks,
    // `freeFrom` is deliberately not carried: the availability tabs work off
    // week-to-week transitions, so a "first free week" would be a dead field in a
    // payload that ships to every viewer.
    tentativeOnly: person.tentativeOnly,
    staffedToday: isStaffedOn(rolesByStaff.get(person.staffId) ?? [], today),
  }));

  // From the calendar, not from `availability[0]` — an empty billable population
  // would otherwise yield zero columns rather than five empty ones.
  const weekStarts = availabilityWeekStarts(fromWeek);
  const horizonEnd = addDays(today, horizonDays);

  const upcomingRoles = buildUpcomingRoles(
    roles,
    openRoles,
    staffById,
    today,
    horizonEnd,
  );

  const borrowed = buildBorrowed(roles, staffById, today);

  // Enumerated, not spread — same rule as `people` above. `UpcomingLeave` is built
  // field-by-field today, but a spread here would auto-ship whatever is added to it
  // next, which is exactly the failure this module is written to prevent.
  const leave: OrgLeave[] = buildUpcomingTimeOff(
    staff,
    roles,
    timeOff,
    today,
  ).map((row) => ({
    staffId: row.staffId,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    workingDays: row.workingDays,
    type: row.type,
    startsInDays: row.startsInDays,
    ongoing: row.ongoing,
    projects: row.projects,
    personLineOfBusiness: staffById.get(row.staffId)?.lineOfBusiness ?? null,
  }));

  return { weekStarts, people, upcomingRoles, borrowed, leave, today };
}

/**
 * Roles whose start or end falls inside `[today, horizonEnd]`, soonest first.
 *
 * A role can appear **twice** — once as "starting" and once as "ending" — when a
 * short engagement both begins and finishes inside the horizon. That is correct:
 * they are two different things to act on, and collapsing them would hide the end
 * date of anything brief.
 *
 * Open positions are included deliberately. A role kicking off in two weeks with
 * nobody in it is the most actionable row on the page, and a staffed-only list
 * would omit exactly that.
 */
function buildUpcomingRoles(
  roles: readonly AllocationRoleRow[],
  openRoles: readonly OpenRoleRow[],
  staffById: ReadonlyMap<string, AllocationStaffRow>,
  today: string,
  horizonEnd: string,
): OrgUpcomingRole[] {
  const rows: OrgUpcomingRole[] = [];

  const add = (
    role: OpenRoleRow,
    staffId: string | null,
    kind: "starting" | "ending",
    date: string,
  ) => {
    const person = staffId === null ? null : staffById.get(staffId);
    rows.push({
      roleId: role.id,
      projectId: role.projectId,
      projectName: role.projectName,
      roleType: role.roleType,
      roleLineOfBusiness: role.lineOfBusiness,
      staffId,
      staffName: person?.name ?? null,
      personLineOfBusiness: person?.lineOfBusiness ?? null,
      startDate: role.startDate,
      endDate: role.endDate,
      kind,
      inDays: daysBetween(today, date),
    });
  };

  const consider = (role: OpenRoleRow, staffId: string | null) => {
    if (role.startDate >= today && role.startDate <= horizonEnd) {
      add(role, staffId, "starting", role.startDate);
    }
    if (role.endDate >= today && role.endDate <= horizonEnd) {
      add(role, staffId, "ending", role.endDate);
    }
  };

  for (const role of roles) consider(role, role.staffId);
  for (const role of openRoles) consider(role, null);

  return rows.sort(
    (a, b) =>
      a.inDays - b.inDays ||
      a.projectName.localeCompare(b.projectName) ||
      (a.staffName ?? "").localeCompare(b.staffName ?? ""),
  );
}

/**
 * People on a role today whose work sits in a different line of business than they
 * do — the cross-LOB lending the org is doing right now, by name.
 *
 * Only **confirmed** roles count, consistently with `staffedToday`: a tentative
 * cross-LOB booking hasn't lent anyone anywhere yet. Someone with no home line of
 * business is skipped — unknown is not "borrowed", and guessing would invent
 * lending that isn't happening.
 *
 * A person lent to two foreign projects yields two rows; each is a separate
 * arrangement with its own end date.
 *
 * Related: `/dashboards/utilization`'s `buildLobAlignment`
 * (`@/lib/utilization/utilization-report`) measures the same idea as a day-weighted
 * *aggregate* over a range. This is the point-in-time, named-people view. Keep both
 * — they answer "how much drift is there" and "who, specifically, today".
 */
function buildBorrowed(
  roles: readonly AllocationRoleRow[],
  staffById: ReadonlyMap<string, AllocationStaffRow>,
  today: string,
): OrgBorrowed[] {
  const rows: OrgBorrowed[] = [];

  for (const role of roles) {
    if (role.status !== "confirmed") continue;
    if (role.startDate > today || role.endDate < today) continue;

    const person = staffById.get(role.staffId);
    const home = person?.lineOfBusiness;
    if (!person || !home || home === role.lineOfBusiness) continue;

    rows.push({
      staffId: person.id,
      name: person.name,
      homeLineOfBusiness: home,
      projectId: role.projectId,
      projectName: role.projectName,
      roleLineOfBusiness: role.lineOfBusiness,
      roleType: role.roleType,
      endDate: role.endDate,
    });
  }

  return rows.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.projectName.localeCompare(b.projectName),
  );
}

/**
 * Narrow a payload to one line of business, matching each person's **home** line
 * of business. One control, one meaning, across all five widgets.
 *
 * The one necessary exception is an **open** upcoming role: it has no holder, so
 * there is no home LOB to match. Those fall back to the role's own line of
 * business — otherwise every unfilled position would vanish the moment a filter is
 * applied, losing the rows the panel exists to surface.
 */
export function filterByLineOfBusiness(
  status: OrgStatus,
  lineOfBusiness: LineOfBusiness | null,
): OrgStatus {
  if (lineOfBusiness === null) return status;

  return {
    ...status,
    people: status.people.filter(
      (person) => person.lineOfBusiness === lineOfBusiness,
    ),
    upcomingRoles: status.upcomingRoles.filter((role) =>
      role.staffId === null
        ? role.roleLineOfBusiness === lineOfBusiness
        : role.personLineOfBusiness === lineOfBusiness,
    ),
    borrowed: status.borrowed.filter(
      (row) => row.homeLineOfBusiness === lineOfBusiness,
    ),
    leave: status.leave.filter(
      (row) => row.personLineOfBusiness === lineOfBusiness,
    ),
  };
}

/**
 * The delivery disciplines the staffing table breaks down by, in delivery order.
 *
 * Overhead disciplines (Leadership, Sales, Solutions, Operations) are deliberately
 * **not** rows: "how much of Sales is staffed onto client projects" isn't a question
 * anyone asks, and four near-permanently-empty rows made the table's real signal
 * harder to read. A test asserts this list is exactly the complement of
 * `NON_BILLABLE_ROLES`, so it cannot drift from the single source in `staff-enums`.
 */
export const DELIVERY_ROLES: readonly Role[] = [
  "ENGINEER",
  "DESIGNER",
  "ARCHITECT",
  "DELIVERY",
  "QA",
];

/** Stable display order for the staffing table's rows. */
const ROLE_ORDER: readonly RoleStaffing["role"][] = [
  ...DELIVERY_ROLES,
  "OTHER",
];

/**
 * How much of the bench is working, as of now.
 *
 * Counts **people**, not hours — "how many of us are on something" is the question,
 * and an hours-weighted version of it is what `/dashboards/utilization` is for.
 *
 * There is deliberately **no small-cohort suppression** here — a one-person
 * discipline row reports its rate like any other. Suppression is for figures that
 * would otherwise expose something gated: the org's old year-to-date table withheld
 * rates for cohorts under three people because individual *logged hours* sit behind
 * `timesheets.edit` (that table and its guard were both deleted with
 * `getOrgUtilization`). These are headcounts over allocations `/allocations` already
 * publishes by name, so a small row reveals nothing new. Don't add one.
 *
 * Empty-cohort rows are still returned so the table can render "—" rather than a
 * fabricated 0%.
 */
export function summarizeStaffing(
  people: readonly OrgPerson[],
): StaffingSummary {
  const staffed = people.filter((person) => person.staffedToday).length;
  const fullTimeCount = people.filter(
    (person) => person.employmentType === "FULL_TIME",
  ).length;

  // Anyone in the billable population whose discipline isn't a delivery one — an
  // overhead role carrying `isBillable: true` (the employment fact and the role are
  // independent), or no recorded role at all. They get an `OTHER` row rather than
  // being dropped, so the discipline rows always account for the same people as
  // Overall; a breakdown that silently omits someone is worse than an odd row.
  const bucketOf = (person: OrgPerson): RoleStaffing["role"] =>
    person.role && DELIVERY_ROLES.includes(person.role) ? person.role : "OTHER";

  const byRole = ROLE_ORDER.map((role) => {
    const cohort = people.filter((person) => bucketOf(person) === role);
    return {
      role,
      ...rateOf(
        cohort.filter((person) => person.staffedToday).length,
        cohort.length,
      ),
    };
  })
    // Keep every delivery discipline so the table's shape is stable between
    // filters, but only surface OTHER when somebody actually lands there.
    .filter((row) => row.role !== "OTHER" || row.headcount > 0);

  return {
    ...rateOf(staffed, people.length),
    fullTimeCount,
    normalizedRate: fullTimeCount > 0 ? staffed / fullTimeCount : null,
    byRole,
  };
}

/** One tab of the availability strip. */
export type AvailabilityTab = {
  weekStart: string;
  /**
   * The people this tab lists. **Not cumulative:** tab 0 is everyone on the bench
   * now; every later tab is only whoever *becomes* free that week.
   */
  people: OrgPerson[];
  /**
   * Total spare capacity across the whole (filtered) population in this week, in
   * full-time equivalents — a capacity fact about the week, so it counts everyone
   * free, not just the newly free. Listed separately from `people.length` for that
   * reason: the two answer different questions and must not be conflated.
   */
  freeFte: number;
  /** How many of the listed people hold only tentative work. */
  tentativeCount: number;
};

/**
 * Split a population into availability tabs: the bench now, then the people who
 * free up in each subsequent week.
 *
 * **Each tab is a delta, not a running total.** "Who's free in three weeks" is
 * really two questions, and a cumulative list only answers the weaker one: a tab
 * repeating everyone already idle buries the two people whose project actually ends
 * that week under a roster of long-term bench. So tab 0 is the bench — free *now* —
 * and tab `i` lists whoever is free in week `i` but was **not** free in week `i−1`.
 *
 * Keyed on the previous week rather than "not free in any earlier week", so somebody
 * who finishes, gets restaffed, and finishes again shows up **both** times. They
 * genuinely free up twice, and a first-time-only rule would silently drop the second
 * occasion — the one a staffing lead hasn't already planned around.
 *
 * A consequence worth stating: the tab counts do **not** sum to the number of people
 * with spare capacity, and no tab except the first shows total availability. That is
 * the intended trade — `freeFte` carries the capacity view alongside.
 */
export function buildAvailabilityTabs(
  people: readonly OrgPerson[],
  weekStarts: readonly string[],
): AvailabilityTab[] {
  const isFree = (person: OrgPerson, index: number) =>
    (person.weeks[index]?.freePercent ?? 0) >= AVAILABLE_THRESHOLD_PERCENT;

  // Spare capacity comes from `summarizeWeeks` rather than a second local sum: it's
  // the same "how much of this week is free" arithmetic the planner's strip uses, and
  // two copies would drift the first time the definition changes.
  const capacity = summarizeWeeks(people, weekStarts);

  return weekStarts.map((weekStart, index) => {
    const listed = people
      .filter(
        (person) =>
          isFree(person, index) && (index === 0 || !isFree(person, index - 1)),
      )
      .sort(
        (a, b) =>
          (b.weeks[index]?.freePercent ?? 0) -
            (a.weeks[index]?.freePercent ?? 0) || a.name.localeCompare(b.name),
      );

    return {
      weekStart,
      people: listed,
      freeFte: capacity[index]?.freeFte ?? 0,
      tentativeCount: listed.filter((person) => person.tentativeOnly).length,
    };
  });
}

/**
 * Group roles by the project they belong to, soonest first.
 *
 * Roles arrive one per person-per-seat, but they are *sold and staffed per project*:
 * three engineers rolling onto one engagement in the same week is one event to plan
 * for, not three, and a flat list buries that by interleaving unrelated projects.
 */
export function groupRolesByProject(
  roles: readonly OrgUpcomingRole[],
): ProjectRoleGroup[] {
  const byProject = new Map<string, ProjectRoleGroup>();

  for (const role of roles) {
    const existing = byProject.get(role.projectId);
    if (existing) {
      existing.roles.push(role);
      existing.inDays = Math.min(existing.inDays, role.inDays);
      continue;
    }
    byProject.set(role.projectId, {
      projectId: role.projectId,
      projectName: role.projectName,
      lineOfBusiness: role.roleLineOfBusiness,
      inDays: role.inDays,
      roles: [role],
    });
  }

  const groups = [...byProject.values()];
  for (const group of groups) {
    group.roles.sort(
      (a, b) =>
        a.inDays - b.inDays ||
        (a.staffName ?? "").localeCompare(b.staffName ?? ""),
    );
  }
  return groups.sort(
    (a, b) => a.inDays - b.inDays || a.projectName.localeCompare(b.projectName),
  );
}

/** One project's worth of roles starting or ending inside the horizon. */
export type ProjectRoleGroup = {
  projectId: string;
  projectName: string;
  /** The line of business of the work, taken from its roles. */
  lineOfBusiness: LineOfBusiness;
  /** Days until the soonest role in the group — what the group sorts on. */
  inDays: number;
  roles: OrgUpcomingRole[];
};

/** Employment-type filter for the availability panel. */
export type EmploymentFilter = EmploymentType | null;

/** Narrow a population by employment type; `null` keeps everyone. */
export function filterByEmploymentType(
  people: readonly OrgPerson[],
  employmentType: EmploymentFilter,
): OrgPerson[] {
  return employmentType === null
    ? [...people]
    : people.filter((person) => person.employmentType === employmentType);
}
