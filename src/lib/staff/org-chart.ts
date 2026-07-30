/**
 * Turns the flat staff list into the reporting forest the org chart renders, and
 * prunes that forest down to a filter. A pure, client-importable module (no `db`/
 * drizzle, no `server-only`) — the chart is a client component and does all of its
 * filtering in memory over one server read.
 *
 * **`staff.managerId` is not a trustworthy tree.** It has no DB-level cycle or
 * self-reference constraint, and the CSV import that populates it only warns
 * (ADR 0026), so every reader guards itself — `getFeedbackAboutReports` and the
 * performance seed both do. This module's contract is stronger than "usually
 * fine": whatever the edges do, {@link buildOrgForest} terminates and returns a
 * forest containing **every input row exactly once**. Nobody is dropped, nobody is
 * duplicated, and a loop cannot hang the page. That invariant is what the test
 * file exists to pin.
 */

import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import type { Role } from "@/lib/staff/staff-enums";

/**
 * The minimal row shape the chart needs. Deliberately declared here rather than
 * imported from the read, so this module stays free of `server-only` and tests can
 * build fixtures without inventing skills/location/billability. `StaffDirectoryEntry`
 * satisfies it structurally — if that ever stops compiling at the call site, the two
 * have drifted and the call site is the right place to find out.
 */
export type OrgChartEntry = {
  id: string;
  name: string;
  email: string;
  imageUrl: string | null;
  isActive: boolean;
  lineOfBusiness: LineOfBusiness | null;
  role: Role | null;
  managerId: string | null;
};

/**
 * Why a node sits at the top of the forest. `"top"` is the normal case (no
 * manager); the other three are **data problems** the chart surfaces as a badge,
 * because nothing else in the app ever shows them — the importer only warns.
 */
export type OrgRootReason = "top" | "self" | "orphan" | "cycle";

export type OrgChartNode = {
  entry: OrgChartEntry;
  /** Distance from the top of the forest. 0 = a root. Pruning never changes it. */
  depth: number;
  /** Direct reports, in input order — i.e. alphabetical, as the read sorts by name. */
  reports: OrgChartNode[];
  /** Everyone beneath this node at any depth — what the `+N` collapse badge counts. */
  descendantCount: number;
  /** Set only on roots; null on everyone else. */
  rootReason: OrgRootReason | null;
  /**
   * True when this node survived pruning *only* because a descendant matched — it
   * is context, not a result. Always `false` straight out of {@link buildOrgForest};
   * only {@link pruneOrgForest} ever sets it.
   */
  passThrough: boolean;
};

/**
 * Build the reporting forest from a flat staff list.
 *
 * Returns roots sorted by subtree size (largest first), then by name. That is not
 * cosmetic: without it a handful of unmanaged ICs render above the leaders who
 * actually top the org.
 *
 * Malformed edges are normalised rather than rejected — a self-reference, a
 * dangling `managerId`, or a reporting loop each becomes a root carrying the
 * {@link OrgRootReason} that explains it. **Every input row appears exactly once
 * in the result**, which callers can rely on and the tests assert on every fixture.
 */
export function buildOrgForest(
  entries: readonly OrgChartEntry[],
): OrgChartNode[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  // Pass 1 — normalise each parent edge, recording why anyone ends up a root.
  // Self-reference is caught here rather than falling out of cycle detection, so
  // the diagnostic matches the importer's own `self` warning class (ADR 0026).
  const parent = new Map<string, string | null>();
  const reason = new Map<string, OrgRootReason>();
  for (const entry of entries) {
    if (entry.managerId === null) {
      parent.set(entry.id, null);
      reason.set(entry.id, "top");
    } else if (entry.managerId === entry.id) {
      parent.set(entry.id, null);
      reason.set(entry.id, "self");
    } else if (!byId.has(entry.managerId)) {
      // Unreachable with today's read (it returns every staff row, and the FK is
      // `on delete set null`). The guard is the contract that lets a future caller
      // pass a filtered subset without silently amputating a whole subtree.
      parent.set(entry.id, null);
      reason.set(entry.id, "orphan");
    } else {
      parent.set(entry.id, entry.managerId);
    }
  }

  // Pass 2 — cut cycles. Iterative on purpose: a pathological chain must not blow
  // the stack. Walking upward from each unsettled node, re-entering a node already
  // on the current path means the edge into it closes a loop, so we cut that node's
  // own parent edge and the loop unrolls into a chain rooted there. Exactly one
  // edge dies per cycle, so nobody is dropped and nobody is duplicated. Someone
  // reporting *into* a cycle is untouched — their walk stops at the settled node.
  const ON_PATH = 1;
  const SETTLED = 2;
  const state = new Map<string, typeof ON_PATH | typeof SETTLED>();
  for (const entry of entries) {
    if (state.get(entry.id) === SETTLED) continue;
    const path: string[] = [];
    let current: string | null | undefined = entry.id;
    while (current != null && state.get(current) !== SETTLED) {
      if (state.get(current) === ON_PATH) {
        parent.set(current, null);
        reason.set(current, "cycle");
        break;
      }
      state.set(current, ON_PATH);
      path.push(current);
      current = parent.get(current) ?? null;
    }
    for (const id of path) state.set(id, SETTLED);
  }

  // Pass 3 — materialise one node per entry, then link. Iterating `entries` in
  // order means `reports` inherits the read's name ordering.
  const nodes = new Map<string, OrgChartNode>();
  for (const entry of entries) {
    nodes.set(entry.id, {
      entry,
      depth: 0,
      reports: [],
      descendantCount: 0,
      rootReason: null,
      passThrough: false,
    });
  }
  const roots: OrgChartNode[] = [];
  for (const entry of entries) {
    const node = nodes.get(entry.id);
    if (node === undefined) continue;
    const parentId = parent.get(entry.id) ?? null;
    const parentNode = parentId === null ? undefined : nodes.get(parentId);
    if (parentNode === undefined) {
      node.rootReason = reason.get(entry.id) ?? "top";
      roots.push(node);
    } else {
      parentNode.reports.push(node);
    }
  }

  // Pass 4 — depth + descendant counts. Recursion is safe now: pass 2 guarantees
  // the structure is acyclic, so this is a genuine tree walk.
  for (const root of roots) annotate(root, 0);

  roots.sort(
    (a, b) =>
      b.descendantCount - a.descendantCount ||
      a.entry.name.localeCompare(b.entry.name),
  );
  return roots;
}

/** Post-order: stamp `depth`, return (and store) the number of descendants. */
function annotate(node: OrgChartNode, depth: number): number {
  node.depth = depth;
  let total = 0;
  for (const report of node.reports) total += 1 + annotate(report, depth + 1);
  node.descendantCount = total;
  return total;
}

/**
 * Keep every node that matches, plus every ancestor of a match — marked
 * `passThrough` — so the chain from a root down to a match is never broken.
 * Non-matching nodes with no surviving descendant are dropped entirely.
 *
 * Rebuilds nodes; never mutates the input, so the unfiltered forest stays intact
 * for the next keystroke. `depth` is preserved (nobody is re-parented), while
 * `descendantCount` is recomputed over the **surviving** subtree — so a collapsed
 * node's `+N` badge counts what you would actually be hiding, not what the person
 * manages company-wide.
 */
export function pruneOrgForest(
  roots: readonly OrgChartNode[],
  matches: (entry: OrgChartEntry) => boolean,
): OrgChartNode[] {
  const visit = (node: OrgChartNode): OrgChartNode | null => {
    const reports = node.reports
      .map(visit)
      .filter((report): report is OrgChartNode => report !== null);
    const self = matches(node.entry);
    if (!self && reports.length === 0) return null;
    return {
      ...node,
      reports,
      passThrough: !self,
      descendantCount: reports.reduce(
        (total, report) => total + 1 + report.descendantCount,
        0,
      ),
    };
  };
  return roots.map(visit).filter((root): root is OrgChartNode => root !== null);
}

/**
 * The chart's filter dimensions. "No filter" is `null` rather than the `ALL`
 * sentinel because `ALL` lives in a `"use client"` module and this one stays pure —
 * the toolbar maps `ALL → null` at the boundary.
 */
export type OrgChartFilters = {
  search: string;
  lineOfBusiness: string | null;
  role: string | null;
  showInactive: boolean;
};

/**
 * Build the predicate {@link pruneOrgForest} takes. Someone with no employment
 * history (`role`/`lineOfBusiness` null) fails those filters, matching how the
 * directory grid already treats them.
 *
 * **`showInactive` belongs here, not in a pre-filter.** Dropping inactive people
 * before the forest is built turns an inactive manager into a missing parent, and
 * her whole subtree detaches and jumps to the top level. Routed through the prune,
 * she renders as a faded pass-through with her reports still hanging off her.
 */
export function orgChartMatcher(
  filters: OrgChartFilters,
): (entry: OrgChartEntry) => boolean {
  const query = filters.search.trim().toLowerCase();
  return (entry) => {
    if (!filters.showInactive && !entry.isActive) return false;
    if (query && !entry.name.toLowerCase().includes(query)) return false;
    if (
      filters.lineOfBusiness &&
      entry.lineOfBusiness !== filters.lineOfBusiness
    )
      return false;
    if (filters.role && entry.role !== filters.role) return false;
    return true;
  };
}

/** Total nodes in a forest, context rows included. */
export function countOrgNodes(roots: readonly OrgChartNode[]): number {
  let total = 0;
  for (const root of roots) total += 1 + root.descendantCount;
  return total;
}

/**
 * Nodes that actually matched — the chart's "showing N of M people" numerator.
 * Counting every rendered node instead would report the ancestors dragged along
 * for context as results, so narrowing to one person could read "showing 6 of 42".
 */
export function countOrgMatches(roots: readonly OrgChartNode[]): number {
  let total = 0;
  const visit = (node: OrgChartNode) => {
    if (!node.passThrough) total += 1;
    for (const report of node.reports) visit(report);
  };
  for (const root of roots) visit(root);
  return total;
}

/**
 * Which nodes start collapsed, seeded once from the unfiltered forest. A node
 * qualifies if it has reports and is **either** deep (`depth >= expandedDepth`)
 * **or** wide (more direct reports than {@link LARGE_FAN_OUT}).
 *
 * The width rule is the one that earns its keep. Depth alone leaves a manager with
 * 50 direct reports fully expanded whenever they sit shallow in the org — which is
 * exactly where big teams sit — dumping a 3,000px column on load. Collapsing on
 * width instead means that team arrives as one `+50` row you open deliberately,
 * while a normal 3–6 report manager is unaffected.
 */
export function defaultCollapsedIds(
  roots: readonly OrgChartNode[],
  expandedDepth: number,
): Set<string> {
  const collapsed = new Set<string>();
  const visit = (node: OrgChartNode) => {
    if (
      node.reports.length > 0 &&
      (node.depth >= expandedDepth || node.reports.length > LARGE_FAN_OUT)
    )
      collapsed.add(node.entry.id);
    for (const report of node.reports) visit(report);
  };
  for (const root of roots) visit(root);
  return collapsed;
}

/** Every id with at least one report — what "Collapse all" collapses. */
export function collapsibleIds(roots: readonly OrgChartNode[]): string[] {
  const ids: string[] = [];
  const visit = (node: OrgChartNode) => {
    if (node.reports.length > 0) ids.push(node.entry.id);
    for (const report of node.reports) visit(report);
  };
  for (const root of roots) visit(root);
  return ids;
}

/**
 * Nodes shallower than this start expanded. At company scale (4 roots → managers →
 * ICs) that opens the whole org, which is the point of an org chart; the constant
 * exists so a deeper org doesn't dump five levels at once. Expand all / Collapse
 * all override it either way.
 */
export const DEFAULT_EXPANDED_DEPTH = 2;

/**
 * More direct reports than this and the node starts collapsed however shallow it
 * sits. Set just above a normal span of control, so it catches the genuinely wide
 * teams (a manager with a flat 50-person org) and leaves ordinary ones open.
 */
export const LARGE_FAN_OUT = 12;
