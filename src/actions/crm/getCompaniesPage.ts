import "server-only";

import { asc, count } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { companies } from "@/lib/db/schema";

export const COMPANIES_PAGE_SIZE = 20;

export type CompanyRow = {
  id: string;
  name: string;
  websiteUrl: string | null;
  isPartner: boolean;
};

export type CompaniesPage = {
  rows: CompanyRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/**
 * One page of companies, ordered by name. Server-side paginated (offset/limit +
 * a count) — the dataset is expected to grow large. `page` is clamped into range
 * so an out-of-bounds query param can't return an empty page past the end.
 */
export async function getCompaniesPage(
  page = 1,
  pageSize = COMPANIES_PAGE_SIZE,
): Promise<CompaniesPage> {
  const [{ total }] = await db.select({ total: count() }).from(companies);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);

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
