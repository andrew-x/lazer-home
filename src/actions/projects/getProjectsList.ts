import "server-only";

import {
  and,
  asc,
  count,
  eq,
  exists,
  ilike,
  inArray,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { latestDeliveryNoteFirst } from "@/actions/projects/getProjectDeliveryNotes";
import { getProjectsMarginContext } from "@/actions/projects/getProjectsMarginContext";
import { CRM_PAGE_SIZE, clampPage, type Page } from "@/lib/core/pagination";
import { compareSortValues, type SortDirection } from "@/lib/core/sort";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import { db } from "@/lib/db/db";
import {
  companies,
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
import {
  type DeliveryCoverageRole,
  deliveryCoverageGaps,
  deliveryManagersOf,
} from "@/lib/projects/delivery-coverage";
import type { BillingType } from "@/lib/projects/project-billing";
import {
  deriveProjectLinesOfBusiness,
  deriveProjectStatus,
  PROJECT_STATUS_BUCKETS,
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
import {
  type ProjectRoleStatus,
  ROLE_STATUS,
} from "@/lib/projects/project-role-status";
import {
  derivedStatusCondition,
  latestHealthRating,
  latestRoleEndDate,
} from "@/lib/projects/project-status-sql";
import {
  DEFAULT_PROJECT_SORT,
  DEFAULT_SORT_DIRECTION,
  type ProjectSortKey,
} from "@/lib/projects/projects-list-sort";
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
  /**
   * The distinct named staff on the project's **live `DELIVERY` roles** — the
   * derived set, all-time rather than "who runs it today", matching the detail
   * sidebar and the `dm` filter. Empty when no live delivery role has a person on
   * it, which now also covers "there is a delivery role but nobody is in it".
   */
  deliveryManagerNames: string[];
  roleCount: number;
  /**
   * How many of those roles are **open positions** (`staffId === null`) — the
   * staffing gap. Counted from the role rows `assembleRows` already fetches, so
   * it costs no extra query. Includes cancelled roles, exactly as `roleCount`
   * does, so the two figures always describe the same set.
   */
  openRoleCount: number;
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
  /** A `staff.id`; matches projects this person holds a live delivery role on. */
  deliveryManagerId?: string;
};

/** A delivery-manager option for the list filter: a staff id + display name. */
export type DeliveryManagerOption = { id: string; name: string };

/** How the paginated list is ordered: a sortable column plus a direction. */
export type ProjectsListOrder = {
  key: ProjectSortKey;
  dir: SortDirection;
};

/** The order the list takes when the URL asks for nothing. */
export const DEFAULT_PROJECTS_ORDER: ProjectsListOrder = {
  key: DEFAULT_PROJECT_SORT,
  dir: DEFAULT_SORT_DIRECTION[DEFAULT_PROJECT_SORT],
};

/**
 * `<expr> asc|desc [nulls last]`, built by branching rather than interpolating the
 * direction, so no part of an `order by` is ever assembled from a string.
 *
 * **Nulls last in BOTH directions** for the derived expressions — Postgres defaults
 * to nulls-first under `desc`, which would open a descending health sort with every
 * unrated project. "Not rated" is unknown, not worst; the in-memory margin sort says
 * the same thing through `compareSortValues`.
 */
function ordered(expr: SQL, dir: SortDirection, nullable: boolean): SQL {
  if (dir === "asc") {
    return nullable ? sql`${expr} asc nulls last` : sql`${expr} asc`;
  }
  return nullable ? sql`${expr} desc nulls last` : sql`${expr} desc`;
}

/**
 * Order clauses for the row query. `endDate` and `health` sort by correlated
 * subqueries (`latestRoleEndDate`, `latestHealthRating`) because neither is a
 * column on `projects` — the date range and the health rating are both derived.
 * Name always breaks ties so paging stays stable across equal values.
 *
 * `margin` is absent by design: it is computed in `assembleRows` from roles and the
 * cost basis, so it has no SQL expression at all and takes the separate in-memory
 * path in `getProjectsPage`.
 */
function orderClauses({ key, dir }: ProjectsListOrder): SQL[] {
  const tiebreak = asc(projects.name);
  switch (key) {
    case "client":
      return [ordered(sql`${companies.name}`, dir, false), tiebreak];
    case "endDate":
      return [ordered(latestRoleEndDate, dir, true), tiebreak];
    case "health":
      return [ordered(latestHealthRating, dir, true), tiebreak];
    default:
      return [ordered(sql`${projects.name}`, dir, false)];
  }
}

/**
 * "A live delivery role" in SQL — the role rows that make someone this project's
 * delivery manager. Declared once and shared by the `dm` filter and the filter's
 * own option set so the two can't disagree about who runs what.
 *
 * LOCKSTEP: this is the SQL mirror of `isDeliveryCoverage` in
 * `@/lib/projects/delivery-coverage`. Change one and change the other. (It omits
 * that predicate's `staffId is not null` half because both call sites either
 * compare a specific staff id or inner-join `staff`, which drops open roles for
 * free.)
 */
const liveDeliveryRole = and(
  eq(projectRoles.roleType, "DELIVERY"),
  ne(projectRoles.status, ROLE_STATUS.cancelled),
);

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
    // A project matches iff this staff member holds a live delivery role on it.
    conditions.push(
      exists(
        db
          .select({ n: sql`1` })
          .from(projectRoles)
          .where(
            and(
              eq(projectRoles.projectId, projects.id),
              liveDeliveryRole,
              eq(projectRoles.staffId, filters.deliveryManagerId),
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
 * The staff who hold a live delivery role on at least one project, ordered by name
 * — the option set for the list's delivery-manager filter. Distinct so a person
 * running several projects appears once.
 *
 * Cancelled roles are excluded, so the option set is derived from live plan data
 * and can shrink when a role is cancelled. That's deliberate: the `dm` filter
 * excludes them too, and an option that matched nothing would read as a broken
 * filter rather than as an empty result.
 */
export async function getDeliveryManagerOptions(): Promise<
  DeliveryManagerOption[]
> {
  return db
    .selectDistinct({ id: staff.id, name: staff.name })
    .from(projectRoles)
    .innerJoin(staff, eq(projectRoles.staffId, staff.id))
    .where(liveDeliveryRole)
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
 * Assemble full `ProjectListItem`s for the given base rows: one
 * latest-delivery-note query and one role query (both scoped to these ids), then
 * derive status, lines of business, role count, the date range, the delivery
 * managers, the plan margin, the latest health rating and the risk flags in JS. No
 * N+1 — two follow-up queries regardless of row count, plus the request-scoped
 * `getProjectsMarginContext`. Preserves the input order.
 *
 * There used to be a third query, grouping `project_delivery_managers` to names.
 * A delivery manager is now a `DELIVERY` role, so both the Delivery column and the
 * coverage flag fall out of the role rows already in hand — which also means the
 * two can't disagree about who runs the project (ADR 0067).
 *
 * Called once per section, so the grouped view runs each of those queries five
 * times per render. That's the multiplier anything added here inherits.
 */
async function assembleRows(
  baseRows: ProjectBaseRow[],
): Promise<ProjectListItem[]> {
  if (baseRows.length === 0) return [];
  const ids = baseRows.map((row) => row.id);

  const coverageRolesByProject = new Map<string, DeliveryCoverageRole[]>();
  const roleStatusesByProject = new Map<string, ProjectRoleStatus[]>();
  const openRolesByProject = new Map<string, number>();
  const roleLobsByProject = new Map<string, LineOfBusiness[]>();
  const marginRolesByProject = new Map<string, MarginRoleInput[]>();
  const startDateByProject = new Map<string, string>();
  const endDateByProject = new Map<string, string>();

  // The latest delivery note per project, via `distinct on` rather than pulling
  // every note back and reducing in JS. Both are correct given identical
  // ordering; the difference is payload growth. `getStaffDirectory` reduces in JS
  // and its own comment anticipates this case — an employment history is a
  // handful of rows per person forever, while a note a week over a two-year
  // engagement is ~100 rows per project, and the unpaginated Active section can
  // hold every live project at once. This returns at most one row per id
  // regardless, and keeps this function's fixed-query-count contract.
  const healthRows = await db
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
    .orderBy(asc(projectDeliveryNotes.projectId), ...latestDeliveryNoteFirst);

  const healthByProject = new Map(
    healthRows.map((row) => [row.projectId, row]),
  );

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
      // For the Delivery column and the coverage gaps. Left join: a null `staffId`
      // is an open role, which must survive so it still counts toward the plan.
      staffName: staff.name,
      billRate: projectRoles.billRate,
    })
    .from(projectRoles)
    .leftJoin(staff, eq(projectRoles.staffId, staff.id))
    .where(inArray(projectRoles.projectId, ids));

  for (const row of roleRows) {
    const statuses = roleStatusesByProject.get(row.projectId) ?? [];
    statuses.push(row.status);
    roleStatusesByProject.set(row.projectId, statuses);

    const lobs = roleLobsByProject.get(row.projectId) ?? [];
    lobs.push(row.lineOfBusiness);
    roleLobsByProject.set(row.projectId, lobs);

    // Every role, not just the delivery ones: the gap detector needs the
    // non-delivery lines to know what window there is to cover.
    const coverageRoles = coverageRolesByProject.get(row.projectId) ?? [];
    coverageRoles.push(row);
    coverageRolesByProject.set(row.projectId, coverageRoles);

    // A role with no assignee is an open position — the staffing gap the list
    // shows beside the role count.
    if (row.staffId === null) {
      openRolesByProject.set(
        row.projectId,
        (openRolesByProject.get(row.projectId) ?? 0) + 1,
      );
    }

    if (costBasis) {
      const marginRoles = marginRolesByProject.get(row.projectId) ?? [];
      marginRoles.push({
        roleId: row.id,
        roleType: row.roleType,
        status: row.status,
        startDate: row.startDate,
        endDate: row.endDate,
        hoursPerDay: row.hoursPerDay,
        billRate: row.billRate,
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
    const coverageRoles = coverageRolesByProject.get(row.id) ?? [];

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
      deliveryManagerNames: deliveryManagersOf(coverageRoles).map(
        (m) => m.name,
      ),
      roleCount: statuses.length,
      openRoleCount: openRolesByProject.get(row.id) ?? 0,
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
        deliveryCoverageGaps: deliveryCoverageGaps(coverageRoles),
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
 * How many projects sit in each status bucket **under the active filters** — the
 * counts on the list's status tabs.
 *
 * Filter-aware on purpose. The tabs replaced a flat cross-status search view, so a
 * match in a bucket you aren't looking at has to stay discoverable: searching
 * "Acme" from the Active tab shows "Cancelled (1)" rather than silently hiding it.
 *
 * Five `count()` queries rather than one grouped scan: the bucket predicates are
 * correlated-`EXISTS` expressions over `project_roles` (`derivedStatusCondition`),
 * not a column that could be grouped by, and a `CASE` over all five would evaluate
 * every predicate for every row anyway. They run concurrently.
 */
export async function getProjectBucketCounts(
  filters: ProjectsListFilters = {},
): Promise<Record<ProjectStatusBucket, number>> {
  const entries = await Promise.all(
    PROJECT_STATUS_BUCKETS.map(async (bucket) => {
      const [{ total }] = await db
        .select({ total: count() })
        .from(projects)
        .innerJoin(companies, eq(projects.companyId, companies.id))
        .where(projectsWhere([bucket], filters));
      return [bucket, total] as const;
    }),
  );

  return Object.fromEntries(entries) as Record<ProjectStatusBucket, number>;
}

/**
 * One page of projects sorted by plan margin — the path SQL can't take.
 *
 * Margin is computed in `assembleRows` from each role's hours and the viewer's cost
 * basis, so there is no expression to `order by`: the whole filtered bucket has to be
 * assembled, sorted, and only then sliced. Paginating first and sorting the page
 * would produce a list that restarts its ordering every 20 rows.
 *
 * Sorted on `MARGIN_FLAG_CURRENCY`, matching the currency the risk flags are already
 * evaluated in. The display currency is client state (ADR 0057 §8) and never reaches
 * the server, and both figures come from the same native amounts through one rate
 * set, so the ranking holds whichever way the toggle is set.
 *
 * **A viewer without `projects.viewMargin` never gets here** — the page drops
 * `sort=margin` when the read produced no cost basis. Were one to arrive anyway,
 * every `margin` is null, `compareSortValues` treats the set as all-unknown, and the
 * name order the base query applied survives. Do not "repair" that by costing roles
 * purely to order them: the ranking itself is compensation-derived.
 */
async function getProjectsPageByMargin(
  page: number,
  buckets: ProjectStatusBucket[],
  filters: ProjectsListFilters,
  dir: SortDirection,
  pageSize: number,
): Promise<Page<ProjectListItem>> {
  const baseRows = await db
    .select(baseColumns)
    .from(projects)
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .where(projectsWhere(buckets, filters))
    // Name order underneath, so equal margins (and the whole all-null case) stay
    // alphabetical instead of falling back to whatever the planner returned.
    .orderBy(asc(projects.name));

  const rows = await assembleRows(baseRows);
  const sorted = [...rows].sort((a, b) =>
    compareSortValues(
      a.margin?.[MARGIN_FLAG_CURRENCY].margin ?? null,
      b.margin?.[MARGIN_FLAG_CURRENCY].margin ?? null,
      dir,
    ),
  );

  const total = sorted.length;
  const { pageCount, safePage } = clampPage(total, page, pageSize);
  const offset = (safePage - 1) * pageSize;

  return {
    rows: sorted.slice(offset, offset + pageSize),
    total,
    page: safePage,
    pageSize,
    pageCount,
  };
}

/**
 * One page of projects in the given status buckets, with the optional
 * name/company + line-of-business + delivery-manager filters, ordered by `order`.
 * The single read behind the list — every status tab takes this same path.
 *
 * Server-side paginated (offset/limit + a count), with the filter `where` applied to
 * both the count and the row query so the page count reflects the filtered set.
 * `page` is clamped into range.
 *
 * **Except for `margin`**, which has no SQL expression and delegates to
 * `getProjectsPageByMargin` — that one assembles the whole bucket before slicing.
 * It is opt-in by a header click, and it is the only order that costs more than a
 * page's worth of work.
 */
export async function getProjectsPage(
  page: number,
  buckets: ProjectStatusBucket[],
  filters: ProjectsListFilters = {},
  order: ProjectsListOrder = DEFAULT_PROJECTS_ORDER,
  pageSize = CRM_PAGE_SIZE,
): Promise<Page<ProjectListItem>> {
  if (order.key === "margin") {
    return getProjectsPageByMargin(page, buckets, filters, order.dir, pageSize);
  }

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
