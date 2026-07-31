import "server-only";

import {
  and,
  asc,
  count,
  eq,
  exists,
  ilike,
  inArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { latestDeliveryNoteFirst } from "@/actions/projects/getProjectDeliveryNotes";
import { getProjectsMarginContext } from "@/actions/projects/getProjectsMarginContext";
import { CRM_PAGE_SIZE, clampPage, type Page } from "@/lib/core/pagination";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import { db } from "@/lib/db/db";
import {
  companies,
  projectDeliveryManagers,
  projectDeliveryNotes,
  projectRoles,
  projects,
  staff,
} from "@/lib/db/schema";
import {
  type Currency,
  DISPLAY_CURRENCIES,
  type DisplayCurrency,
} from "@/lib/format/currency";
import type { BillingType } from "@/lib/projects/project-billing";
import {
  deriveProjectLinesOfBusiness,
  deriveProjectStatus,
  type ProjectStatusBucket,
} from "@/lib/projects/project-derived";
import {
  MARGIN_FLAG_CURRENCY,
  type ProjectFlag,
  projectFlags,
} from "@/lib/projects/project-flags";
import {
  computeProjectMargin,
  type MarginRoleInput,
} from "@/lib/projects/project-margin";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import {
  derivedStatusCondition,
  latestRoleEndDate,
} from "@/lib/projects/project-status-sql";
import { currentDay } from "@/lib/timesheets/timesheet-week";

/** A project's plan margin, in one display currency. */
export type ProjectListMargin = {
  margin: number | null;
  marginPercent: number | null;
};

export type ProjectListItem = {
  id: string;
  name: string;
  /** Derived from the project's roles (see `project-derived.ts`). */
  status: ProjectRoleStatus;
  /** The distinct lines of business across the project's roles. */
  linesOfBusiness: LineOfBusiness[];
  companyId: string;
  companyName: string;
  deliveryManagerNames: string[];
  roleCount: number;
  /** Earliest role start date ("YYYY-MM-DD"); null when the project has no roles. */
  startDate: string | null;
  /** Latest role end date ("YYYY-MM-DD"); null when the project has no roles. */
  endDate: string | null;
  /**
   * Health from the project's MOST RECENT delivery note (latest `noteDate`, with
   * `createdAt` breaking a tie), or **null** when it has none — which reads as "Not
   * rated" and, deliberately, earns no flag.
   *
   * Unlike `margin` this is NOT capability-gated: a health rating is a delivery
   * judgement, not anything derived from an individual's compensation, so every
   * viewer sees it and the low-health tag fires for everyone.
   */
  latestHealth: number | null;
  /**
   * The date of that note ("YYYY-MM-DD"). Shipped alongside the figure because the
   * rating could be a year old, and a bare "3/10" on a card reads as *now*.
   */
  latestHealthDate: string | null;
  /** Null when no budget has been set — the card says so rather than showing "—". */
  billingType: BillingType | null;
  /** The derived risk tags for this project (see `project-flags.ts`). */
  flags: ProjectFlag[];
  /**
   * Plan margin, precomputed in each display currency, or **null** when the viewer
   * lacks `projects.viewMargin`.
   *
   * Precomputed server-side for both currencies rather than shipping native amounts
   * for the client to convert (the detail page's approach, ADR 0029): there are only
   * two display currencies, so two figures per project is far less payload than every
   * role's hours/type/assignee — and, load-bearing, it means no individual's
   * compensation-derived hourly cost is ever sent to the browser for the *list*,
   * which has no per-role table to justify it.
   */
  margin: Record<DisplayCurrency, ProjectListMargin> | null;
};

/** Optional filters shared by the list views — name/company search, a line of
 * business, and a delivery manager (staff id). */
export type ProjectsListFilters = {
  /** Case-insensitive substring match on project or company name. */
  query?: string;
  lineOfBusiness?: LineOfBusiness;
  /** A `staff.id`; matches projects this person is a delivery manager on. */
  deliveryManagerId?: string;
};

/** A delivery-manager option for the list filter: a staff id + display name. */
export type DeliveryManagerOption = { id: string; name: string };

/** How the paginated list is ordered. */
export type ProjectsListOrder = "name" | "endDate";

/**
 * Order clauses for the row query. `endDate` sorts by the project's latest role
 * end date (`latestRoleEndDate` — a correlated `max`, since the date range is
 * derived, not a column) newest first, projects without roles last; `name` is the
 * alphabetical default. Name always breaks ties so paging stays stable.
 */
function orderClauses(order: ProjectsListOrder): SQL[] {
  if (order === "endDate") {
    return [sql`${latestRoleEndDate} desc nulls last`, asc(projects.name)];
  }
  return [asc(projects.name)];
}

/**
 * The combined `where` for a set of status buckets + the optional filters. Reads
 * the clock once per call for the bucket predicate — the active/past split turns
 * on today's date (see `derivedStatusCondition`).
 */
function projectsWhere(
  buckets: ProjectStatusBucket[],
  filters: ProjectsListFilters,
): SQL | undefined {
  const conditions: SQL[] = [];

  const bucketCondition = derivedStatusCondition(buckets, currentDay());
  if (bucketCondition) conditions.push(bucketCondition);

  if (filters.lineOfBusiness) {
    // A project belongs to a line of business iff one of its roles does.
    conditions.push(
      exists(
        db
          .select({ n: sql`1` })
          .from(projectRoles)
          .where(
            and(
              eq(projectRoles.projectId, projects.id),
              eq(projectRoles.lineOfBusiness, filters.lineOfBusiness),
            ),
          ),
      ),
    );
  }

  if (filters.deliveryManagerId) {
    // A project matches iff this staff member is one of its delivery managers.
    conditions.push(
      exists(
        db
          .select({ n: sql`1` })
          .from(projectDeliveryManagers)
          .where(
            and(
              eq(projectDeliveryManagers.projectId, projects.id),
              eq(projectDeliveryManagers.staffId, filters.deliveryManagerId),
            ),
          ),
      ),
    );
  }

  const query = filters.query?.trim();
  if (query) {
    const term = `%${query}%`;
    const nameMatch = or(
      ilike(projects.name, term),
      ilike(companies.name, term),
    );
    if (nameMatch) conditions.push(nameMatch);
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * The staff who are a delivery manager on at least one project, ordered by name
 * — the option set for the list's delivery-manager filter. Distinct so a person
 * managing several projects appears once.
 */
export async function getDeliveryManagerOptions(): Promise<
  DeliveryManagerOption[]
> {
  return db
    .selectDistinct({ id: staff.id, name: staff.name })
    .from(projectDeliveryManagers)
    .innerJoin(staff, eq(projectDeliveryManagers.staffId, staff.id))
    .orderBy(asc(staff.name));
}

/** The columns every base row query selects — the project's own facts. */
const baseColumns = {
  id: projects.id,
  name: projects.name,
  companyId: projects.companyId,
  companyName: companies.name,
  billingType: projects.billingType,
  budgetAmount: projects.budgetAmount,
  budgetCurrency: projects.budgetCurrency,
};

type ProjectBaseRow = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  billingType: BillingType | null;
  budgetAmount: number | null;
  budgetCurrency: Currency | null;
};

/**
 * Assemble full `ProjectListItem`s for the given base rows: one grouped
 * delivery-manager query, one latest-delivery-note query and one role query (all
 * scoped to these ids), then derive status, lines of business, role count, the date
 * range, the plan margin, the latest health rating and the risk flags in JS. No
 * N+1 — three follow-up queries regardless of row count, plus the request-scoped
 * `getProjectsMarginContext`. Preserves the input order.
 *
 * Called once per section, so the grouped view runs each of those queries five
 * times per render. That's the multiplier anything added here inherits.
 */
async function assembleRows(
  baseRows: ProjectBaseRow[],
): Promise<ProjectListItem[]> {
  if (baseRows.length === 0) return [];
  const ids = baseRows.map((row) => row.id);

  const managersByProject = new Map<string, string[]>();
  const roleStatusesByProject = new Map<string, ProjectRoleStatus[]>();
  const roleLobsByProject = new Map<string, LineOfBusiness[]>();
  const marginRolesByProject = new Map<string, MarginRoleInput[]>();
  const startDateByProject = new Map<string, string>();
  const endDateByProject = new Map<string, string>();

  // Independent of each other and of the margin context, so they overlap.
  const [managerRows, healthRows] = await Promise.all([
    db
      .select({
        projectId: projectDeliveryManagers.projectId,
        name: staff.name,
      })
      .from(projectDeliveryManagers)
      .innerJoin(staff, eq(projectDeliveryManagers.staffId, staff.id))
      .where(inArray(projectDeliveryManagers.projectId, ids))
      .orderBy(asc(staff.name)),

    // The latest delivery note per project, via `distinct on` rather than pulling
    // every note back and reducing in JS. Both are correct given identical
    // ordering; the difference is payload growth. `getStaffDirectory` reduces in JS
    // and its own comment anticipates this case — an employment history is a
    // handful of rows per person forever, while a note a week over a two-year
    // engagement is ~100 rows per project, and the unpaginated Active section can
    // hold every live project at once. This returns at most one row per id
    // regardless, and keeps this function's fixed-query-count contract.
    db
      .selectDistinctOn([projectDeliveryNotes.projectId], {
        projectId: projectDeliveryNotes.projectId,
        projectHealth: projectDeliveryNotes.projectHealth,
        noteDate: projectDeliveryNotes.noteDate,
      })
      .from(projectDeliveryNotes)
      .where(inArray(projectDeliveryNotes.projectId, ids))
      // `distinct on` requires its own expressions to lead the `order by`; the rest
      // is the ordering shared with the detail read, which the table's index is
      // declared to serve in this exact direction.
      .orderBy(asc(projectDeliveryNotes.projectId), ...latestDeliveryNoteFirst),
  ]);

  const healthByProject = new Map(
    healthRows.map((row) => [row.projectId, row]),
  );

  for (const { projectId, name } of managerRows) {
    const list = managersByProject.get(projectId) ?? [];
    list.push(name);
    managersByProject.set(projectId, list);
  }

  const { rates, costBasis } = await getProjectsMarginContext();

  const roleRows = await db
    .select({
      id: projectRoles.id,
      projectId: projectRoles.projectId,
      status: projectRoles.status,
      lineOfBusiness: projectRoles.lineOfBusiness,
      startDate: projectRoles.startDate,
      endDate: projectRoles.endDate,
      roleType: projectRoles.roleType,
      hoursPerDay: projectRoles.hoursPerDay,
      staffId: projectRoles.staffId,
    })
    .from(projectRoles)
    .where(inArray(projectRoles.projectId, ids));

  for (const row of roleRows) {
    const statuses = roleStatusesByProject.get(row.projectId) ?? [];
    statuses.push(row.status);
    roleStatusesByProject.set(row.projectId, statuses);

    const lobs = roleLobsByProject.get(row.projectId) ?? [];
    lobs.push(row.lineOfBusiness);
    roleLobsByProject.set(row.projectId, lobs);

    if (costBasis) {
      const marginRoles = marginRolesByProject.get(row.projectId) ?? [];
      marginRoles.push({
        roleId: row.id,
        roleType: row.roleType,
        status: row.status,
        startDate: row.startDate,
        endDate: row.endDate,
        hoursPerDay: row.hoursPerDay,
        staffId: row.staffId,
        staffHourlyCost:
          (row.staffId && costBasis.staffHourlyCost[row.staffId]) || null,
      });
      marginRolesByProject.set(row.projectId, marginRoles);
    }

    // "YYYY-MM-DD" is zero-padded, so lexicographic min/max === chronological.
    const currentStart = startDateByProject.get(row.projectId);
    if (currentStart === undefined || row.startDate < currentStart) {
      startDateByProject.set(row.projectId, row.startDate);
    }
    const currentEnd = endDateByProject.get(row.projectId);
    if (currentEnd === undefined || row.endDate > currentEnd) {
      endDateByProject.set(row.projectId, row.endDate);
    }
  }

  // One clock read for the whole page, so two cards can't disagree about "soon".
  const today = currentDay();

  return baseRows.map((row) => {
    const statuses = roleStatusesByProject.get(row.id) ?? [];
    const status = deriveProjectStatus(statuses);
    const endDate = endDateByProject.get(row.id) ?? null;
    const latestNote = healthByProject.get(row.id) ?? null;

    const margin = costBasis
      ? listMargin({
          billing: row,
          roles: marginRolesByProject.get(row.id) ?? [],
          openRoleCostUsd: costBasis.openRoleCostUsd,
          usdRates: rates.rates,
        })
      : null;

    return {
      id: row.id,
      name: row.name,
      companyId: row.companyId,
      companyName: row.companyName,
      status,
      linesOfBusiness: deriveProjectLinesOfBusiness(
        roleLobsByProject.get(row.id) ?? [],
      ),
      deliveryManagerNames: managersByProject.get(row.id) ?? [],
      roleCount: statuses.length,
      startDate: startDateByProject.get(row.id) ?? null,
      endDate,
      latestHealth: latestNote?.projectHealth ?? null,
      latestHealthDate: latestNote?.noteDate ?? null,
      billingType: row.billingType,
      margin,
      flags: projectFlags({
        status,
        endDate,
        today,
        margin: margin?.[MARGIN_FLAG_CURRENCY] ?? null,
        latestHealth: latestNote?.projectHealth ?? null,
      }),
    };
  });
}

/**
 * A project's plan margin in each display currency — the whole-project totals from
 * `computeProjectMargin`, with the per-role detail dropped: the list shows one figure
 * per card, and the roles were only ever the inputs to it.
 *
 * A plan with **no counted roles** reports null rather than a number, even when it has
 * a budget. Its cost total is a true zero only because nobody is staffed, so a fixed
 * fee would read as a triumphant 100% margin and a T&M project as exactly 0 — which
 * the flags would then call a loss. Neither is a fact about the engagement; the detail
 * page says the same thing in words ("nothing to cost against the budget").
 *
 * Called once per currency (there are two), so `roleBillableHours`' working-day count
 * runs twice per role. That's the first thing to look at if the unpaginated Active
 * section ever gets long; caching hours per role would break the currency symmetry
 * for no gain at today's scale.
 */
function listMargin({
  billing,
  roles,
  openRoleCostUsd,
  usdRates,
}: {
  billing: {
    billingType: BillingType | null;
    budgetAmount: number | null;
    budgetCurrency: Currency | null;
  };
  roles: MarginRoleInput[];
  openRoleCostUsd: Parameters<
    typeof computeProjectMargin
  >[0]["openRoleCostUsd"];
  usdRates: Record<Currency, number>;
}): Record<DisplayCurrency, ProjectListMargin> {
  const figures = DISPLAY_CURRENCIES.map((displayCurrency) => {
    const { totals, countedRoleCount } = computeProjectMargin({
      billing,
      roles,
      openRoleCostUsd,
      displayCurrency,
      usdRates,
      includeCost: true,
    });
    const unstaffed = countedRoleCount === 0;
    return [
      displayCurrency,
      {
        margin: unstaffed ? null : totals.margin,
        marginPercent: unstaffed ? null : totals.marginPercent,
      },
    ] as const;
  });

  return Object.fromEntries(figures) as Record<
    DisplayCurrency,
    ProjectListMargin
  >;
}

/**
 * Every project in the given status buckets (no pagination), ordered by name.
 * Used for the Tentative, Paused and Active sections, which show in full.
 */
export async function getProjectsInBuckets(
  buckets: ProjectStatusBucket[],
  filters: ProjectsListFilters = {},
): Promise<ProjectListItem[]> {
  const baseRows = await db
    .select(baseColumns)
    .from(projects)
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .where(projectsWhere(buckets, filters))
    .orderBy(asc(projects.name));

  return assembleRows(baseRows);
}

/**
 * One page of projects in the given status buckets, with the optional
 * name/company + line-of-business + delivery-manager filters. Ordered by `order`
 * (`name` by default; `endDate` for the Past and search/filter views —
 * latest-ending first). Server-side paginated (offset/limit + a count) — used for
 * the Past and Cancelled sections and the flat filtered view, whose result sets
 * grow unbounded. The
 * filter `where` is applied to both the count and the row query so the page count
 * reflects the filtered set. `page` is clamped into range.
 */
export async function getProjectsPage(
  page: number,
  buckets: ProjectStatusBucket[],
  filters: ProjectsListFilters = {},
  order: ProjectsListOrder = "name",
  pageSize = CRM_PAGE_SIZE,
): Promise<Page<ProjectListItem>> {
  const where = projectsWhere(buckets, filters);

  const [{ total }] = await db
    .select({ total: count() })
    .from(projects)
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .where(where);
  const { pageCount, safePage } = clampPage(total, page, pageSize);

  const baseRows = await db
    .select(baseColumns)
    .from(projects)
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .where(where)
    .orderBy(...orderClauses(order))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  const rows = await assembleRows(baseRows);
  return { rows, total, page: safePage, pageSize, pageCount };
}
