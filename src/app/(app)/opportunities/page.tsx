import type { Metadata } from "next";
import { getOpportunitiesBoard } from "@/actions/crm/getOpportunitiesBoard";
import { getOpportunitiesPage } from "@/actions/crm/getOpportunitiesPage";
import { AddOpportunityDialog } from "@/components/crm/add-opportunity-dialog";
import { OpportunitiesListFilters } from "@/components/crm/opportunities-list-filters";
import { OpportunitiesTable } from "@/components/crm/opportunities-table";
import { OpportunityBoard } from "@/components/crm/opportunity-board";
import { OpportunityViewToggle } from "@/components/crm/opportunity-view-toggle";
import { PaginationControls } from "@/components/pagination-controls";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { parsePage } from "@/lib/core/pagination";
import {
  LINE_OF_BUSINESS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import {
  OPPORTUNITY_GROUPS,
  type OpportunityGroupId,
} from "@/lib/crm/opportunity-pipeline";

export const metadata: Metadata = { title: "Opportunities" };

type SearchParams = Record<string, string | string[] | undefined>;

/** Validate a raw `stage` param against the known kanban groups (else no filter). */
function parseGroup(value: string | string[] | undefined) {
  return OPPORTUNITY_GROUPS.some((g) => g.id === value)
    ? (value as OpportunityGroupId)
    : undefined;
}

/** Validate a raw `lob` param against the line-of-business enum (else no filter). */
function parseLineOfBusiness(value: string | string[] | undefined) {
  return LINE_OF_BUSINESS.includes(value as LineOfBusiness)
    ? (value as LineOfBusiness)
    : undefined;
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const view = params.view === "list" ? "list" : "board";

  const user = await getCurrentUser();
  const canEdit = user ? userHasPermission(user, { crm: ["edit"] }) : false;
  const canCreateProject = user
    ? userHasPermission(user, { projects: ["edit"] })
    : false;

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          Opportunities
        </h2>
        <p className="text-sm text-muted-foreground">
          The deals in our pipeline, from lead to close.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h3 className="font-heading text-base font-semibold tracking-tight">
              {view === "list" ? "All opportunities" : "Pipeline"}
            </h3>
            <OpportunityViewToggle current={view} />
          </div>
          {canEdit ? <AddOpportunityDialog /> : null}
        </div>

        {view === "list" ? (
          <ListView
            params={params}
            canEdit={canEdit}
            canCreateProject={canCreateProject}
          />
        ) : (
          <BoardView canEdit={canEdit} canCreateProject={canCreateProject} />
        )}
      </section>
    </div>
  );
}

async function BoardView({
  canEdit,
  canCreateProject,
}: {
  canEdit: boolean;
  canCreateProject: boolean;
}) {
  const { cards, cappedTotals } = await getOpportunitiesBoard();
  return (
    <OpportunityBoard
      cards={cards}
      cappedTotals={cappedTotals}
      canEdit={canEdit}
      canCreateProject={canCreateProject}
    />
  );
}

async function ListView({
  params,
  canEdit,
  canCreateProject,
}: {
  params: SearchParams;
  canEdit: boolean;
  canCreateProject: boolean;
}) {
  const opportunities = await getOpportunitiesPage(parsePage(params.oppPage), {
    group: parseGroup(params.stage),
    lineOfBusiness: parseLineOfBusiness(params.lob),
    query: typeof params.q === "string" ? params.q : undefined,
  });

  return (
    <div className="flex flex-col gap-4">
      <OpportunitiesListFilters params={params} />
      <div className="rounded-md border">
        <OpportunitiesTable
          rows={opportunities.rows}
          canEdit={canEdit}
          canCreateProject={canCreateProject}
        />
        <PaginationControls
          basePath="/opportunities"
          params={params}
          paramKey="oppPage"
          page={opportunities.page}
          pageCount={opportunities.pageCount}
        />
      </div>
    </div>
  );
}
