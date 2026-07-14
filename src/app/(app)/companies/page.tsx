import type { Metadata } from "next";
import { getCompaniesPage } from "@/actions/crm/getCompaniesPage";
import { AddCompanyDialog } from "@/components/crm/add-company-dialog";
import { CompaniesTable } from "@/components/crm/companies-table";
import { PaginationControls } from "@/components/crm/pagination-controls";
import { getCurrentUser } from "@/lib/auth";
import { parsePage } from "@/lib/pagination";
import { userHasPermission } from "@/lib/permissions";

export const metadata: Metadata = { title: "Companies" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const [companies, user] = await Promise.all([
    getCompaniesPage(parsePage(params.companiesPage)),
    getCurrentUser(),
  ]);

  const canEdit = user ? userHasPermission(user, { crm: ["edit"] }) : false;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10">
      <header>
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          Companies
        </h2>
        <p className="text-sm text-muted-foreground">
          The clients and partners we work with.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-heading text-base font-semibold tracking-tight">
            All companies
          </h3>
          {canEdit ? <AddCompanyDialog /> : null}
        </div>
        <div className="rounded-md border">
          <CompaniesTable rows={companies.rows} />
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
