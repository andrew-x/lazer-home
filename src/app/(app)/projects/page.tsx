import type { Metadata } from "next";
import {
  type DeliveryManagerOption,
  getDeliveryManagerOptions,
  getProjectsInBuckets,
  getProjectsPage,
} from "@/actions/projects/getProjectsList";
import { getProjectsMarginContext } from "@/actions/projects/getProjectsMarginContext";
import { PaginationControls } from "@/components/pagination-controls";
import { AddProjectDialog } from "@/components/projects/add-project-dialog";
import {
  ProjectsCurrencyProvider,
  ProjectsCurrencyToggle,
} from "@/components/projects/projects-currency";
import {
  ProjectsGrid,
  ProjectsSection,
} from "@/components/projects/projects-grid";
import { ProjectsListFilters } from "@/components/projects/projects-list-filters";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { firstParam } from "@/lib/core/list-href";
import { parsePage } from "@/lib/core/pagination";
import {
  LINE_OF_BUSINESS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import { PROJECT_STATUS_BUCKETS } from "@/lib/projects/project-derived";

export const metadata: Metadata = { title: "Projects" };

type SearchParams = Record<string, string | string[] | undefined>;

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

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const [user, deliveryManagers, marginContext] = await Promise.all([
    getCurrentUser(),
    getDeliveryManagerOptions(),
    // Request-cached, so the section reads below share this one fetch.
    getProjectsMarginContext(),
  ]);

  const query = firstParam(params.q).trim();
  const lineOfBusiness = parseLineOfBusiness(params.lob);
  const deliveryManagerId = parseDeliveryManager(params.dm, deliveryManagers);
  const page = parsePage(params.projectsPage);
  const filtering =
    query !== "" ||
    lineOfBusiness !== undefined ||
    deliveryManagerId !== undefined;

  const canEdit = user
    ? userHasPermission(user, { projects: ["edit"] })
    : false;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
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

      {/* The provider wraps the filter bar AND every section, so the toggle up here
          governs cards rendered further down. */}
      <ProjectsCurrencyProvider>
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap items-end gap-3">
            <ProjectsListFilters
              params={params}
              deliveryManagers={deliveryManagers}
            />
            {/* Cosmetic only — a viewer without `viewMargin` has no figures to
                convert because the read withheld them, not because this is hidden. */}
            {marginContext.costBasis ? (
              <div className="ml-auto">
                <ProjectsCurrencyToggle
                  rates={marginContext.rates}
                  nativeCurrencies={marginContext.nativeCurrencies}
                />
              </div>
            ) : null}
          </div>
          {filtering ? (
            <FilteredView
              params={params}
              page={page}
              query={query}
              lineOfBusiness={lineOfBusiness}
              deliveryManagerId={deliveryManagerId}
            />
          ) : (
            <GroupedView params={params} />
          )}
        </div>
      </ProjectsCurrencyProvider>
    </div>
  );
}

/**
 * The status sections: Active in full, and Tentative / Paused / Past / Cancelled
 * as closed disclosures so the page opens on the work in flight. Past and
 * Cancelled grow without bound, so they page independently (`pastPage` /
 * `cancelledPage`) — and re-open when their own page param says the reader was
 * paging through them, since following a page link is a fresh server render.
 */
async function GroupedView({ params }: { params: SearchParams }) {
  const pastPage = parsePage(params.pastPage);
  const cancelledPage = parsePage(params.cancelledPage);

  const [tentative, paused, active, past, cancelled] = await Promise.all([
    getProjectsInBuckets(["tentative"]),
    getProjectsInBuckets(["paused"]),
    getProjectsInBuckets(["active"]),
    // Most recently finished first — the ones you're most likely to look up.
    getProjectsPage(pastPage, ["past"], {}, "endDate"),
    getProjectsPage(cancelledPage, ["cancelled"]),
  ]);

  const isEmpty =
    tentative.length === 0 &&
    paused.length === 0 &&
    active.length === 0 &&
    past.total === 0 &&
    cancelled.total === 0;

  return (
    <div className="flex flex-col gap-10">
      {/* Collapsed, these are just heading rows, so each cluster of them sits
          closer together than the full sections do. */}
      <div className="flex flex-col gap-6 empty:hidden">
        {tentative.length > 0 ? (
          <ProjectsSection title="Tentative" projects={tentative} collapsible />
        ) : null}
        {paused.length > 0 ? (
          <ProjectsSection title="Paused" projects={paused} collapsible />
        ) : null}
      </div>
      {active.length > 0 ? (
        <ProjectsSection title="Active" projects={active} />
      ) : null}
      <div className="flex flex-col gap-6 empty:hidden">
        {past.total > 0 ? (
          <ProjectsSection
            title="Past"
            projects={past.rows}
            count={past.total}
            collapsible
            defaultOpen={past.page > 1}
          >
            <PaginationControls
              basePath="/projects"
              params={params}
              paramKey="pastPage"
              page={past.page}
              pageCount={past.pageCount}
            />
          </ProjectsSection>
        ) : null}
        {cancelled.total > 0 ? (
          <ProjectsSection
            title="Cancelled"
            projects={cancelled.rows}
            count={cancelled.total}
            collapsible
            defaultOpen={cancelled.page > 1}
          >
            <PaginationControls
              basePath="/projects"
              params={params}
              paramKey="cancelledPage"
              page={cancelled.page}
              pageCount={cancelled.pageCount}
            />
          </ProjectsSection>
        ) : null}
      </div>
      {isEmpty ? (
        <p className="text-sm text-muted-foreground">No projects yet.</p>
      ) : null}
    </div>
  );
}

/** A single flat, paginated grid across all statuses matching the active filters. */
async function FilteredView({
  params,
  page,
  query,
  lineOfBusiness,
  deliveryManagerId,
}: {
  params: SearchParams;
  page: number;
  query: string;
  lineOfBusiness: LineOfBusiness | undefined;
  deliveryManagerId: string | undefined;
}) {
  const result = await getProjectsPage(
    page,
    [...PROJECT_STATUS_BUCKETS],
    { query, lineOfBusiness, deliveryManagerId },
    // Search/filter results read best newest-ending first, not alphabetically.
    "endDate",
  );

  if (result.total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No projects match these filters.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ProjectsGrid projects={result.rows} />
      <PaginationControls
        basePath="/projects"
        params={params}
        paramKey="projectsPage"
        page={result.page}
        pageCount={result.pageCount}
      />
    </div>
  );
}
