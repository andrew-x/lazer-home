/**
 * ADR 0037's "don't reflexively re-add unit tests for pure helpers" still holds —
 * this file is the exception it anticipates, not a backslide. `staff.managerId` has
 * **no DB-level cycle or self-reference constraint** and the CSV import only warns
 * (ADR 0026), so the org chart is handed a graph, not a tree. The invariant that
 * matters — *a cyclic `managerId` graph unrolls into a finite forest containing each
 * person exactly once* — is not something the type checker can express, and getting
 * it wrong is a hung page or a silently missing subtree. That is what the
 * conservation assertions below exist to pin. Don't delete them as a 0037 violation.
 */

import { describe, expect, test } from "bun:test";
import {
  buildOrgForest,
  collapsibleIds,
  countOrgMatches,
  countOrgNodes,
  DEFAULT_EXPANDED_DEPTH,
  defaultCollapsedIds,
  LARGE_FAN_OUT,
  type OrgChartEntry,
  type OrgChartNode,
  orgChartMatcher,
  pruneOrgForest,
} from "./org-chart";

/** A staff row with only the fields a case cares about spelled out. */
function person(
  id: string,
  managerId: string | null,
  overrides: Partial<OrgChartEntry> = {},
): OrgChartEntry {
  return {
    id,
    name: id.toUpperCase(),
    email: `${id}@example.com`,
    imageUrl: null,
    isActive: true,
    lineOfBusiness: null,
    role: null,
    managerId,
    ...overrides,
  };
}

/** Ids in pre-order, so a case can assert on shape without walking by hand. */
function idsOf(roots: readonly OrgChartNode[]): string[] {
  const ids: string[] = [];
  const visit = (node: OrgChartNode) => {
    ids.push(node.entry.id);
    for (const report of node.reports) visit(report);
  };
  for (const root of roots) visit(root);
  return ids;
}

function findNode(
  roots: readonly OrgChartNode[],
  id: string,
): OrgChartNode | null {
  for (const root of roots) {
    if (root.entry.id === id) return root;
    const found = findNode(root.reports, id);
    if (found) return found;
  }
  return null;
}

/**
 * The invariant every fixture must hold: the forest contains each input row
 * exactly once, whatever the edges do.
 */
function expectConservation(entries: readonly OrgChartEntry[]) {
  const roots = buildOrgForest(entries);
  const ids = idsOf(roots);
  expect(ids).toHaveLength(entries.length);
  expect(new Set(ids).size).toBe(entries.length);
  expect(countOrgNodes(roots)).toBe(entries.length);
  return roots;
}

describe("buildOrgForest", () => {
  test("builds a multi-root forest with depths and descendant counts", () => {
    const roots = expectConservation([
      person("root-a", null),
      person("root-b", null),
      person("a1", "root-a"),
      person("a2", "root-a"),
      person("a1x", "a1"),
      person("b1", "root-b"),
    ]);

    expect(roots).toHaveLength(2);
    // Sorted by subtree size: root-a (3 descendants) before root-b (1).
    expect(roots[0].entry.id).toBe("root-a");
    expect(roots[0].descendantCount).toBe(3);
    expect(roots[1].entry.id).toBe("root-b");
    expect(roots[1].descendantCount).toBe(1);

    expect(findNode(roots, "a1")?.depth).toBe(1);
    expect(findNode(roots, "a1x")?.depth).toBe(2);
    expect(findNode(roots, "a1")?.descendantCount).toBe(1);
    expect(roots.every((root) => root.rootReason === "top")).toBe(true);
  });

  test("a self-referencing row becomes a root, not its own child", () => {
    const roots = expectConservation([person("solo", "solo")]);

    expect(roots).toHaveLength(1);
    expect(roots[0].entry.id).toBe("solo");
    expect(roots[0].rootReason).toBe("self");
    expect(roots[0].reports).toEqual([]);
  });

  test("a two-node cycle unrolls into a chain, keeping both people once", () => {
    const roots = expectConservation([person("a", "b"), person("b", "a")]);

    expect(roots).toHaveLength(1);
    expect(roots[0].rootReason).toBe("cycle");
    expect(roots[0].reports).toHaveLength(1);
    // Whichever end becomes the root, the other hangs off it — exactly one edge cut.
    expect(new Set(idsOf(roots))).toEqual(new Set(["a", "b"]));
  });

  test("a three-node cycle keeps a clean subtree hanging off it intact", () => {
    const roots = expectConservation([
      person("a", "c"),
      person("b", "a"),
      person("c", "b"),
      person("leaf", "b"),
      person("deep", "leaf"),
    ]);

    expect(roots).toHaveLength(1);
    expect(roots[0].rootReason).toBe("cycle");
    // The non-cyclic branch survives with its own structure.
    expect(findNode(roots, "leaf")?.reports.map((r) => r.entry.id)).toEqual([
      "deep",
    ]);
  });

  test("someone reporting into a cycle is not itself cut", () => {
    const roots = expectConservation([
      person("a", "b"),
      person("b", "a"),
      person("outsider", "a"),
    ]);

    expect(roots).toHaveLength(1);
    expect(findNode(roots, "outsider")).not.toBeNull();
    expect(findNode(roots, "outsider")?.rootReason).toBeNull();
  });

  test("a dangling managerId surfaces as an orphan root, not a dropped subtree", () => {
    const roots = expectConservation([
      person("stranded", "ghost"),
      person("under", "stranded"),
    ]);

    expect(roots).toHaveLength(1);
    expect(roots[0].entry.id).toBe("stranded");
    expect(roots[0].rootReason).toBe("orphan");
    expect(roots[0].reports.map((r) => r.entry.id)).toEqual(["under"]);
  });

  test("roots sort by subtree size, then by name", () => {
    const roots = buildOrgForest([
      person("zeta", null),
      person("alpha", null),
      person("big", null),
      person("kid", "big"),
    ]);

    // "big" has a report; the other two tie at 0 and fall back to name order.
    expect(roots.map((root) => root.entry.id)).toEqual([
      "big",
      "alpha",
      "zeta",
    ]);
  });

  test("reports preserve input order", () => {
    const roots = buildOrgForest([
      person("boss", null),
      person("first", "boss"),
      person("second", "boss"),
      person("third", "boss"),
    ]);

    expect(roots[0].reports.map((r) => r.entry.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  test("an empty staff list is an empty forest", () => {
    expect(buildOrgForest([])).toEqual([]);
  });
});

describe("pruneOrgForest", () => {
  const forest = () =>
    buildOrgForest([
      person("leader", null),
      person("eng-mgr", "leader", { role: "ENGINEER" }),
      person("eng", "eng-mgr", { role: "ENGINEER" }),
      person("design-mgr", "leader", { role: "DESIGNER" }),
      person("designer", "design-mgr", { role: "DESIGNER" }),
      person("hidden-eng", "design-mgr", { role: "ENGINEER" }),
    ]);

  test("no matches prunes to nothing", () => {
    expect(pruneOrgForest(forest(), () => false)).toEqual([]);
  });

  test("an ancestor-only match keeps the whole chain as pass-through", () => {
    const pruned = pruneOrgForest(
      forest(),
      (entry) => entry.id === "hidden-eng",
    );

    expect(idsOf(pruned)).toEqual(["leader", "design-mgr", "hidden-eng"]);
    expect(findNode(pruned, "leader")?.passThrough).toBe(true);
    expect(findNode(pruned, "design-mgr")?.passThrough).toBe(true);
    expect(findNode(pruned, "hidden-eng")?.passThrough).toBe(false);
  });

  test("non-matching non-ancestor siblings are dropped entirely", () => {
    const pruned = pruneOrgForest(
      forest(),
      (entry) => entry.role === "ENGINEER",
    );

    expect(findNode(pruned, "designer")).toBeNull();
    // ...but the designer manager survives, because an engineer reports to her.
    expect(findNode(pruned, "design-mgr")?.passThrough).toBe(true);
  });

  test("a matching node's non-matching descendants are dropped", () => {
    const pruned = pruneOrgForest(forest(), (entry) => entry.id === "eng-mgr");

    expect(findNode(pruned, "eng-mgr")?.reports).toEqual([]);
  });

  test("descendantCount counts only survivors, so +N matches what is hidden", () => {
    const pruned = pruneOrgForest(
      forest(),
      (entry) => entry.role === "ENGINEER",
    );

    // leader keeps eng-mgr, eng, design-mgr and hidden-eng — four, not five.
    expect(findNode(pruned, "leader")?.descendantCount).toBe(4);
    expect(findNode(pruned, "design-mgr")?.descendantCount).toBe(1);
  });

  test("countOrgMatches counts matches, not the ancestors kept for context", () => {
    const pruned = pruneOrgForest(
      forest(),
      (entry) => entry.id === "hidden-eng",
    );

    // Three rows render; exactly one of them is a result.
    expect(countOrgNodes(pruned)).toBe(3);
    expect(countOrgMatches(pruned)).toBe(1);
  });

  test("countOrgMatches equals the node count when nothing is pruned", () => {
    const all = pruneOrgForest(forest(), () => true);
    expect(countOrgMatches(all)).toBe(countOrgNodes(all));
  });

  test("depth survives pruning unchanged", () => {
    const pruned = pruneOrgForest(
      forest(),
      (entry) => entry.id === "hidden-eng",
    );

    expect(findNode(pruned, "hidden-eng")?.depth).toBe(2);
  });

  test("does not mutate the input forest", () => {
    const roots = forest();
    pruneOrgForest(roots, (entry) => entry.id === "eng");

    expect(countOrgNodes(roots)).toBe(6);
    expect(roots[0].passThrough).toBe(false);
  });

  test("hiding an inactive manager leaves her reports attached, not orphaned", () => {
    const roots = buildOrgForest([
      person("leader", null),
      person("gone", "leader", { isActive: false }),
      person("still-here", "gone"),
    ]);

    const pruned = pruneOrgForest(
      roots,
      orgChartMatcher({
        search: "",
        lineOfBusiness: null,
        role: null,
        showInactive: false,
      }),
    );

    // The departed manager stays as context so the chain holds — she is NOT
    // filtered out of the input, which would strand `still-here` at the top.
    expect(idsOf(pruned)).toEqual(["leader", "gone", "still-here"]);
    expect(findNode(pruned, "gone")?.passThrough).toBe(true);
    expect(findNode(pruned, "still-here")?.depth).toBe(2);
  });

  test("an inactive leaf disappears", () => {
    const roots = buildOrgForest([
      person("leader", null),
      person("departed", "leader", { isActive: false }),
    ]);

    const pruned = pruneOrgForest(
      roots,
      orgChartMatcher({
        search: "",
        lineOfBusiness: null,
        role: null,
        showInactive: false,
      }),
    );

    expect(idsOf(pruned)).toEqual(["leader"]);
  });
});

describe("orgChartMatcher", () => {
  const base = {
    search: "",
    lineOfBusiness: null,
    role: null,
    showInactive: true,
  };

  test("an empty filter set matches everyone", () => {
    expect(orgChartMatcher(base)(person("a", null))).toBe(true);
  });

  test("search is a case-insensitive substring on name", () => {
    const entry = person("a", null, { name: "Priya Chandra" });
    expect(orgChartMatcher({ ...base, search: "  chan " })(entry)).toBe(true);
    expect(orgChartMatcher({ ...base, search: "CHAN" })(entry)).toBe(true);
    expect(orgChartMatcher({ ...base, search: "okafor" })(entry)).toBe(false);
  });

  test("dimension filters are exact, and a person with no employment fails them", () => {
    const engineer = person("a", null, { role: "ENGINEER" });
    const unknown = person("b", null);

    expect(orgChartMatcher({ ...base, role: "ENGINEER" })(engineer)).toBe(true);
    expect(orgChartMatcher({ ...base, role: "DESIGNER" })(engineer)).toBe(
      false,
    );
    expect(orgChartMatcher({ ...base, role: "ENGINEER" })(unknown)).toBe(false);
    expect(
      orgChartMatcher({ ...base, lineOfBusiness: "FINTECH" })(unknown),
    ).toBe(false);
  });

  test("showInactive gates the active flag", () => {
    const departed = person("a", null, { isActive: false });
    expect(orgChartMatcher(base)(departed)).toBe(true);
    expect(orgChartMatcher({ ...base, showInactive: false })(departed)).toBe(
      false,
    );
  });
});

describe("collapse helpers", () => {
  const roots = () =>
    buildOrgForest([
      person("leader", null),
      person("mgr", "leader"),
      person("ic", "mgr"),
      person("deep", "ic"),
    ]);

  test("defaultCollapsedIds only names nodes with reports at or below the depth", () => {
    expect(defaultCollapsedIds(roots(), 2)).toEqual(new Set(["ic"]));
    expect(defaultCollapsedIds(roots(), 1)).toEqual(new Set(["mgr", "ic"]));
    // `deep` is a leaf, so it is never collapsible however shallow the cutoff.
    expect(defaultCollapsedIds(roots(), 0)).toEqual(
      new Set(["leader", "mgr", "ic"]),
    );
  });

  test("collapsibleIds names every node with reports", () => {
    expect(new Set(collapsibleIds(roots()))).toEqual(
      new Set(["leader", "mgr", "ic"]),
    );
  });

  test("a wide manager starts collapsed however shallow they sit", () => {
    const wide = buildOrgForest([
      person("leader", null),
      person("normal-mgr", "leader"),
      person("wide-mgr", "leader"),
      ...Array.from({ length: LARGE_FAN_OUT + 1 }, (_, i) =>
        person(`report-${i}`, "wide-mgr"),
      ),
      ...Array.from({ length: 3 }, (_, i) => person(`ok-${i}`, "normal-mgr")),
    ]);

    // Both managers sit at depth 1, inside DEFAULT_EXPANDED_DEPTH — only the wide
    // one is collapsed, and that is the whole point of the width rule.
    const collapsed = defaultCollapsedIds(wide, DEFAULT_EXPANDED_DEPTH);
    expect(collapsed.has("wide-mgr")).toBe(true);
    expect(collapsed.has("normal-mgr")).toBe(false);
    expect(collapsed.has("leader")).toBe(false);
  });
});
