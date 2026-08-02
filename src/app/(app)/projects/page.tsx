import type { Metadata } from "next";
import {
  type DeliveryManagerOption,
  getDeliveryManagerOptions,
  getProjectBucketCounts,
  getProjectsPage,
} from "@/actions/projects/getProjectsList";
import { getProjectsMarginContext } from "@/actions/projects/getProjectsMarginContext";
import { EmptyState } from "@/components/empty-state";
import { PaginationControls } from "@/components/pagination-controls";
import { AddProjectDialog } from "@/components/projects/add-project-dialog";
import {
  ProjectsCurrencyProvider,
  ProjectsCurrencyToggle,
} from "@/components/projects/projects-currency";
import { ProjectsListFilters } from "@/components/projects/projects-list-filters";
import { ProjectsStatusTabs } from "@/components/projects/projects-status-tabs";
import { ProjectsTable } from "@/components/projects/projects-table";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { firstParam, type SearchParams } from "@/lib/core/list-href";
import { parsePage } from "@/lib/core/pagination";
import {
  LINE_OF_BUSINESS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import {
  DEFAULT_PROJECT_SORT,
  DEFAULT_SORT_DIRECTION,
  PROJECTS_PAGE_KEY,
  PROJECTS_STATUS_KEY,
  parseProjectSort,
  parseProjectStatus,
  parseSortDirection,
} from "@/lib/projects/projects-list-sort";

export const metadata: Metadata = { title: "Projects" };

/** Validate a raw `lob` param against the line-of-business enum (else no filter). */
function parseLineOfBusiness(value: string | string[] | undefined) {
  return LINE_OF_BUSINESS.includes(value as LineOfBusiness)
    ? (value as LineOfBusiness)
    : undefined;
}

/** Validate a raw `dm` param against the known delivery managers (else no filter). */
function parseDeliveryManager(
  value: string | string[] | undefined,
  options: DeliveryManagerOption[],
) {
  const id = firstParam(value);
  return options.some((option) => option.id === id) ? id : undefined;
}

/**
 * The projects list: a status tab strip over one sortable, paginated table.
 *
 * Every tab takes the same read — there is no longer a grouped-vs-filtered branch,
 * and no longer three page params. See
 * [ADR 0060](../../../../docs/decisions/0060-projects-list-as-a-sortable-table.md).
 *
 * Wider than the other list pages (`max-w-7xl`, not `max-w-5xl`): nine columns do not
 * fit the standard shell, and the table's whole value is that its figures line up
 * into comparable columns rather than wrapping.
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const [user, deliveryManagers, marginContext] = await Promise.all([
    getCurrentUser(),
    getDeliveryManagerOptions(),
    // Request-cached, so the reads below share this one fetch.
    getProjectsMarginContext(),
  ]);

  const query = firstParam(params.q).trim();
  const lineOfBusiness = parseLineOfBusiness(params.lob);
  const deliveryManagerId = parseDeliveryManager(params.dm, deliveryManagers);
  const filters = { query, lineOfBusiness, deliveryManagerId };

  const status = parseProjectStatus(firstParam(params[PROJECTS_STATUS_KEY]));
  const page = parsePage(params[PROJECTS_PAGE_KEY]);

  /**
   * PERMISSIONS: `projects.viewMargin` decides both whether the Margin column exists
   * and whether the list may be *ordered* by margin. The second is not cosmetic — a
   * margin-ranked list discloses which engagements are most and least profitable,
   * and that ranking is derived from individual compensation just as the figures are.
   *
   * The gate is `costBasis`, which `getProjectCostBasis` returns as `null` for a
   * viewer without the capability (ADR 0053 §7) — one decision, read here rather than
   * re-derived. Dropping `sort=margin` to the default is what makes a hand-typed URL
   * inert; do not "fix" it downstream by costing roles purely to order them.
   */
  const canViewMargin = marginContext.costBasis !== null;
  const requestedSort = parseProjectSort(firstParam(params.sort));
  const sortKey =
    requestedSort !== undefined && (requestedSort !== "margin" || canViewMargin)
      ? requestedSort
      : DEFAULT_PROJECT_SORT;
  const sort = {
    key: sortKey,
    // A rejected sort key takes its own default direction: the `dir` in the URL
    // belonged to the request we just dropped, so honouring it would leave
    // `?sort=typo&dir=desc` rendering names Z→A while claiming to be unsorted.
    dir:
      sortKey === requestedSort
        ? parseSortDirection(firstParam(params.dir), sortKey)
        : DEFAULT_SORT_DIRECTION[sortKey],
  };

  const [result, counts] = await Promise.all([
    getProjectsPage(page, [status], filters, sort),
    getProjectBucketCounts(filters),
  ]);

  const canEdit = user
    ? userHasPermission(user, { projects: ["edit"] })
    : false;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            Projects
          </h2>
          <p className="text-sm text-muted-foreground">
            Client engagements and the people staffed on them.
          </p>
        </div>
        {canEdit ? <AddProjectDialog /> : null}
      </header>

      {/* The provider wraps the filter bar AND the table, so the toggle up here
          governs the Margin figures rendered below. */}
      <ProjectsCurrencyProvider>
        <div className="flex flex-col gap-6">
          <ProjectsStatusTabs params={params} active={status} counts={counts} />

          <div className="flex flex-wrap items-end gap-3">
            <ProjectsListFilters
              params={params}
              deliveryManagers={deliveryManagers}
            />
            {/* Cosmetic only — a viewer without `viewMargin` has no figures to
                convert because the read withheld them, not because this is hidden. */}
            {canViewMargin ? (
              <div className="ml-auto">
                <ProjectsCurrencyToggle
                  rates={marginContext.rates}
                  nativeCurrencies={marginContext.nativeCurrencies}
                />
              </div>
            ) : null}
          </div>

          {result.total === 0 ? (
            <EmptyState bordered>No projects match these filters.</EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              <ProjectsTable
                projects={result.rows}
                params={params}
                sort={sort}
                showMargin={canViewMargin}
              />
              <PaginationControls
                basePath="/projects"
                params={params}
                paramKey={PROJECTS_PAGE_KEY}
                page={result.page}
                pageCount={result.pageCount}
              />
            </div>
          )}
        </div>
      </ProjectsCurrencyProvider>
    </div>
  );
}
