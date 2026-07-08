import "server-only";

import { asc, count } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { companies } from "@/lib/db/schema";
import { CRM_PAGE_SIZE, clampPage, type Page } from "@/lib/pagination";

export type CompanyRow = {
  id: string;
  name: string;
  websiteUrl: string | null;
  isPartner: boolean;
};

/**
 * One page of companies, ordered by name. Server-side paginated (offset/limit +
 * a count) — the dataset is expected to grow large. `page` is clamped into range
 * so an out-of-bounds query param can't return an empty page past the end.
 */
export async function getCompaniesPage(
  page = 1,
  pageSize = CRM_PAGE_SIZE,
): Promise<Page<CompanyRow>> {
  const [{ total }] = await db.select({ total: count() }).from(companies);
  const { pageCount, safePage } = clampPage(total, page, pageSize);

  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      websiteUrl: companies.websiteUrl,
      isPartner: companies.isPartner,
    })
    .from(companies)
    .orderBy(asc(companies.name))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  return { rows, total, page: safePage, pageSize, pageCount };
}
