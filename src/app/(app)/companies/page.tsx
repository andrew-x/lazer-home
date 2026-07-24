import type { Metadata } from "next";
import { getCompaniesPage } from "@/actions/crm/getCompaniesPage";
import { AddCompanyDialog } from "@/components/crm/add-company-dialog";
import { CompaniesListFilters } from "@/components/crm/companies-list-filters";
import { CompaniesTable } from "@/components/crm/companies-table";
import { PaginationControls } from "@/components/pagination-controls";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { parsePage } from "@/lib/core/pagination";
import {
  COMPANY_STATUS_TAGS,
  type CompanyStatusTag,
} from "@/lib/crm/company-status";

export const metadata: Metadata = { title: "Companies" };

type SearchParams = Record<string, string | string[] | undefined>;

/** Narrow a raw query param to a known status tag, or undefined. */
function parseStatus(
  value: string | string[] | undefined,
): CompanyStatusTag | undefined {
  return COMPANY_STATUS_TAGS.find((tag) => tag === value);
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : undefined;
  const status = parseStatus(params.status);
  const city = typeof params.city === "string" ? params.city : undefined;
  const nearby = params.nearby === "1";

  const [companies, user] = await Promise.all([
    getCompaniesPage(parsePage(params.companiesPage), {
      query,
      status,
      city,
      nearby,
    }),
    getCurrentUser(),
  ]);

  const canEdit = user ? userHasPermission(user, { crm: ["edit"] }) : false;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            Companies
          </h2>
          <p className="text-sm text-muted-foreground">
            The clients and partners we work with.
          </p>
        </div>
        {canEdit ? <AddCompanyDialog /> : null}
      </header>

      <section className="flex flex-col gap-3">
        <CompaniesListFilters params={params} />
        <div className="rounded-md border">
          <CompaniesTable
            rows={companies.rows}
            filtered={
              query !== undefined || status !== undefined || city !== undefined
            }
          />
          <PaginationControls
            basePath="/companies"
            params={params}
            paramKey="companiesPage"
            page={companies.page}
            pageCount={companies.pageCount}
          />
        </div>
      </section>
    </div>
  );
}
