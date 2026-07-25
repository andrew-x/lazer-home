/**
 * Shared querystring helpers for the URL-backed CRM list views. The list filter
 * bars (companies, contacts, opportunities) and `PaginationControls` all rebuild
 * the current querystring while changing a few keys — they differ only by base
 * path and the name of the page key. That logic lives here once instead of being
 * re-declared as a `hrefWith`/`buildHref` copy per component.
 */

/** The parsed search params a page hands its list controls. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** First string value of a param (mirrors how the pages read them). */
export function firstParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Build a `basePath` href from the current `params` with `updates` applied,
 * preserving every other param. `pageKey` is always dropped (a filter change
 * resets to page 1), so pagination passes the target page as an update to set it
 * explicitly. In `updates`, a `null`/empty value drops the key; any other value
 * is set (replacing whatever the params held).
 */
export function buildListHref(
  basePath: string,
  pageKey: string,
  params: SearchParams,
  updates: Record<string, string | null>,
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === pageKey || key in updates) continue;
    if (typeof value === "string") sp.append(key, value);
    else if (Array.isArray(value)) for (const v of value) sp.append(key, v);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value !== null && value !== "") sp.set(key, value);
  }
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
