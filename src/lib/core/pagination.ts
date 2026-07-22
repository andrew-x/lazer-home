/**
 * Shared server-side pagination primitives. CRM list reads (companies, contacts,
 * opportunities) all page the same way — a fixed page size, an offset/limit
 * query plus a count, and the same `{ rows, total, page, pageSize, pageCount }`
 * envelope — so the size, the envelope type, and the clamp arithmetic live here
 * once instead of being re-declared per action.
 */

/** Rows per page for CRM list views. */
export const CRM_PAGE_SIZE = 20;

/** Parse a 1-based page query param; anything invalid falls back to page 1. */
export function parsePage(value: string | string[] | undefined): number {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** The envelope every paginated read returns. `page`/`pageCount` are clamped. */
export type Page<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/**
 * Clamp a requested `page` into the valid range for `total` rows at `pageSize`.
 * There is always at least one page (even when empty), so an out-of-bounds query
 * param can't return a page past the end. Returns the total `pageCount` and the
 * clamped `safePage` for use as the offset base.
 */
export function clampPage(
  total: number,
  page: number,
  pageSize: number,
): { pageCount: number; safePage: number } {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  return { pageCount, safePage };
}
