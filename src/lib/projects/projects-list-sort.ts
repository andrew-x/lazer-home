/**
 * The projects list's sort vocabulary: which columns sort, which way each one
 * sorts on first click, and how to parse both out of the URL.
 *
 * A pure, client-importable module (no `db`/drizzle) because both sides need it —
 * the `server-only` read turns a key into an `order by`, and the table (a client
 * component) turns a header click into the next URL. Sorting is server-side and
 * URL-backed precisely because the list is paginated: a client-side sort would
 * only reorder the current page, which reads as the whole list being sorted.
 *
 * See docs/decisions/0060-projects-list-as-a-sortable-table.md.
 */

import type { SortDirection } from "@/lib/core/sort";
import {
  PROJECT_STATUS_BUCKETS,
  type ProjectStatusBucket,
} from "@/lib/projects/project-derived";

/**
 * The list's pagination param. One key, because every status tab now runs through
 * one paginated read — the old page carried three (`projectsPage`, `pastPage`,
 * `cancelledPage`) to page two collapsed sections and a flat filtered view
 * independently.
 */
export const PROJECTS_PAGE_KEY = "page";

/** The list's status-tab param. Absent means the default tab (Active). */
export const PROJECTS_STATUS_KEY = "status";

/**
 * The status tabs, left to right. Active leads because it is the default and the
 * work in flight is what the page is for; the rest follow in derived-status order
 * with the finished buckets last. Deliberately its own order rather than
 * `PROJECT_STATUS_BUCKETS`, which is the canonical set in status order.
 */
export const PROJECT_STATUS_TABS: ProjectStatusBucket[] = [
  "active",
  "tentative",
  "paused",
  "past",
  "cancelled",
];

/** The bucket shown when the URL says nothing: the work currently running. */
export const DEFAULT_PROJECT_STATUS: ProjectStatusBucket = "active";

/** Validate a raw `status` param against the buckets (else the default tab). */
export function parseProjectStatus(
  value: string | undefined,
): ProjectStatusBucket {
  return PROJECT_STATUS_BUCKETS.includes(value as ProjectStatusBucket)
    ? (value as ProjectStatusBucket)
    : DEFAULT_PROJECT_STATUS;
}

/** The sortable columns. Everything else on the row is context, not a question. */
export const PROJECT_SORT_KEYS = [
  "name",
  "client",
  "endDate",
  "health",
  "margin",
] as const;

export type ProjectSortKey = (typeof PROJECT_SORT_KEYS)[number];

/** The list's order when the URL says nothing: alphabetical, like every other list. */
export const DEFAULT_PROJECT_SORT: ProjectSortKey = "name";

/**
 * The direction a column takes on its **first** click, so one click lands on the
 * question people actually have. Names read A–Z; dates read latest-first; health
 * and margin read *worst*-first, because the reason you sort by them is triage.
 * (Clicking the already-active column flips it — see `nextSortDirection`.)
 */
export const DEFAULT_SORT_DIRECTION: Record<ProjectSortKey, SortDirection> = {
  name: "asc",
  client: "asc",
  endDate: "desc",
  health: "asc",
  margin: "asc",
};

/** Validate a raw `sort` param against the sortable columns (else the default). */
export function parseProjectSort(
  value: string | undefined,
): ProjectSortKey | undefined {
  return PROJECT_SORT_KEYS.includes(value as ProjectSortKey)
    ? (value as ProjectSortKey)
    : undefined;
}

/** Validate a raw `dir` param, falling back to the column's own first-click default. */
export function parseSortDirection(
  value: string | undefined,
  key: ProjectSortKey,
): SortDirection {
  if (value === "asc" || value === "desc") return value;
  return DEFAULT_SORT_DIRECTION[key];
}

/**
 * Clicking a header: the active column flips direction, an inactive one starts at
 * its own default rather than always at ascending.
 */
export function nextSortDirection(
  key: ProjectSortKey,
  active: { key: ProjectSortKey; dir: SortDirection },
): SortDirection {
  if (key !== active.key) return DEFAULT_SORT_DIRECTION[key];
  return active.dir === "asc" ? "desc" : "asc";
}
