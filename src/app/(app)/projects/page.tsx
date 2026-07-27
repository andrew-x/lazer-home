import type { Metadata } from "next";
import {
  type DeliveryManagerOption,
  getDeliveryManagerOptions,
  getProjectsInBuckets,
  getProjectsPage,
} from "@/actions/projects/getProjectsList";
import { PaginationControls } from "@/components/pagination-controls";
import { AddProjectDialog } from "@/components/projects/add-project-dialog";
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

  const [user, deliveryManagers] = await Promise.all([
    getCurrentUser(),
    getDeliveryManagerOptions(),
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

      <div className="flex flex-col gap-8">
        <ProjectsListFilters
          params={params}
          deliveryManagers={deliveryManagers}
        />
        {filtering ? (
          <FilteredView
            params={params}
            page={page}
            query={query}
            lineOfBusiness={lineOfBusiness}
            deliveryManagerId={deliveryManagerId}
          />
        ) : (
          <GroupedView params={params} page={page} />
        )}
      </div>
    </div>
  );
}

/** The status sections; Tentative, Paused, and Active in full, Other paginated. */
async function GroupedView({
  params,
  page,
}: {
  params: SearchParams;
  page: number;
}) {
  const [tentative, paused, active, other] = await Promise.all([
    getProjectsInBuckets(["tentative"]),
    getProjectsInBuckets(["paused"]),
    getProjectsInBuckets(["active"]),
    getProjectsPage(page, ["other"]),
  ]);

  const isEmpty =
    tentative.length === 0 &&
    paused.length === 0 &&
    active.length === 0 &&
    other.total === 0;

  return (
    <div className="flex flex-col gap-10">
      {tentative.length > 0 ? (
        <ProjectsSection title="Tentative" projects={tentative} />
      ) : null}
      {paused.length > 0 ? (
        <ProjectsSection title="Paused" projects={paused} />
      ) : null}
      {active.length > 0 ? (
        <ProjectsSection title="Active" projects={active} />
      ) : null}
      {other.total > 0 ? (
        <ProjectsSection
          title="Other"
          projects={other.rows}
          count={other.total}
        >
          <PaginationControls
            basePath="/projects"
            params={params}
            paramKey="projectsPage"
            page={other.page}
            pageCount={other.pageCount}
          />
        </ProjectsSection>
      ) : null}
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
