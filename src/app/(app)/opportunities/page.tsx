import type { Metadata } from "next";
import { getOpportunitiesPage } from "@/actions/crm/getOpportunitiesPage";
import { AddOpportunityDialog } from "@/components/crm/add-opportunity-dialog";
import { OpportunitiesTable } from "@/components/crm/opportunities-table";
import { PaginationControls } from "@/components/crm/pagination-controls";
import { getCurrentUser } from "@/lib/auth";
import { userHasPermission } from "@/lib/permissions";

export const metadata: Metadata = { title: "Opportunities" };

type SearchParams = Record<string, string | string[] | undefined>;

/** Parse a 1-based page query param; anything invalid falls back to page 1. */
function parsePage(value: string | string[] | undefined): number {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const [opportunities, user] = await Promise.all([
    getOpportunitiesPage(parsePage(params.opportunitiesPage)),
    getCurrentUser(),
  ]);

  const canEdit = user ? userHasPermission(user, { crm: ["edit"] }) : false;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
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
          <h3 className="font-heading text-base font-semibold tracking-tight">
            Pipeline
          </h3>
          {canEdit ? <AddOpportunityDialog /> : null}
        </div>
        <div className="rounded-md border">
          <OpportunitiesTable rows={opportunities.rows} />
          <PaginationControls
            basePath="/opportunities"
            params={params}
            paramKey="opportunitiesPage"
            page={opportunities.page}
            pageCount={opportunities.pageCount}
          />
        </div>
      </section>
    </div>
  );
}
