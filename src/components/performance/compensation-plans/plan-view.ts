import { ALL } from "@/components/form/filters";
import {
  compareSortValues,
  type SortState,
} from "@/components/form/sort-header";
import type { PlanRowView } from "./plan-row-view";

/**
 * Filtering and ordering for the plan grid — pure functions over the row views, so
 * the editor stays a render loop and this stays testable in isolation.
 *
 * Both operate in memory on the already-loaded rows. A plan is a cohort of tens of
 * people, not a paginated list: it all arrives in one payload, so a round trip to
 * re-filter it would be slower and would fight the autosave drafts.
 */

export type PlanFilters = {
  /** Case-insensitive substring of the person's name. */
  query: string;
  lineOfBusiness: string;
  role: string;
  billableType: string;
  status: string;
};

export const EMPTY_PLAN_FILTERS: PlanFilters = {
  query: "",
  lineOfBusiness: ALL,
  role: ALL,
  billableType: ALL,
  status: ALL,
};

export function hasActivePlanFilters(filters: PlanFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.lineOfBusiness !== ALL ||
    filters.role !== ALL ||
    filters.billableType !== ALL ||
    filters.status !== ALL
  );
}

export function filterPlanRows(
  views: PlanRowView[],
  filters: PlanFilters,
): PlanRowView[] {
  const query = filters.query.trim().toLowerCase();

  return views.filter(({ item, draft }) => {
    if (query && !item.name.toLowerCase().includes(query)) return false;
    if (
      filters.lineOfBusiness !== ALL &&
      item.lineOfBusiness !== filters.lineOfBusiness
    )
      return false;
    if (filters.role !== ALL && item.role !== filters.role) return false;
    if (
      filters.billableType !== ALL &&
      item.billableType !== filters.billableType
    )
      return false;
    // Status matches the LIVE draft, not the last-saved item: everything else in
    // the grid is draft-driven, and a filter that lagged a click behind would be
    // the odd one out. The consequence is that advancing a row's status while
    // filtered to a single stage drops it out of view — which is the honest
    // reading of "show me everyone still at Rating done".
    if (filters.status !== ALL && draft.status !== filters.status) return false;
    return true;
  });
}

export type PlanSortKey =
  | "name"
  | "rating"
  | "current"
  | "planned"
  | "changeAmount"
  | "changePercent"
  | "gapAmount"
  | "gapPercent"
  | "bonusAmount"
  | "bonusPercent"
  | "status";

export type PlanSort = SortState<PlanSortKey>;

/** Name ascending — what the server already orders by, so nothing jumps on load. */
export const DEFAULT_PLAN_SORT: PlanSort = { key: "name", dir: "asc" };

/**
 * Every key reads off `view.sort`, never off a cell — which is what guarantees the
 * order can't disagree with the numbers on screen. The money keys are pre-normalized
 * to annual USD there; see `plan-row-view.ts` for why.
 */
const SORT_VALUE: Record<
  PlanSortKey,
  (view: PlanRowView) => string | number | null
> = {
  name: (v) => v.sort.name,
  rating: (v) => v.sort.rating,
  current: (v) => v.sort.currentAnnualUsd,
  planned: (v) => v.sort.plannedAnnualUsd,
  changeAmount: (v) => v.sort.changeAnnualUsd,
  changePercent: (v) => v.sort.changePercent,
  gapAmount: (v) => v.sort.gapAnnualUsd,
  gapPercent: (v) => v.sort.gapPercent,
  bonusAmount: (v) => v.sort.bonusUsd,
  bonusPercent: (v) => v.sort.bonusPercent,
  status: (v) => v.sort.status,
};

/**
 * Columns whose interesting end is the top: the biggest raise, the widest gap, the
 * people furthest along. Clicking them first sorts descending, so one click answers
 * the question you clicked to ask.
 */
const DESC_FIRST: ReadonlySet<PlanSortKey> = new Set<PlanSortKey>([
  "rating",
  "current",
  "planned",
  "changeAmount",
  "changePercent",
  "gapAmount",
  "gapPercent",
  "bonusAmount",
  "bonusPercent",
  "status",
]);

/** Clicking the active column flips it; clicking a new one starts it fresh. */
export function nextPlanSort(current: PlanSort, key: PlanSortKey): PlanSort {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: DESC_FIRST.has(key) ? "desc" : "asc" };
}

export function sortPlanRows(
  views: PlanRowView[],
  sort: PlanSort,
): PlanRowView[] {
  const value = SORT_VALUE[sort.key];

  return [...views].sort((a, b) => {
    const primary = compareSortValues(value(a), value(b), sort.dir);
    if (primary !== 0) return primary;
    // Stable tie-break, so equal rows never reshuffle on an unrelated edit.
    const byName = a.sort.name.localeCompare(b.sort.name);
    return byName !== 0 ? byName : a.item.itemId.localeCompare(b.item.itemId);
  });
}
