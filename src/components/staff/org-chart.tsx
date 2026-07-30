"use client";

import { IconSearch } from "@tabler/icons-react";
import { useId, useMemo, useState } from "react";
import type { StaffDirectoryEntry } from "@/actions/staff/getStaffDirectory";
import { EmptyState } from "@/components/empty-state";
import { ALL, FilterLabel, SelectFilter } from "@/components/form/filters";
import { OrgChartNode } from "@/components/staff/org-chart-node";
import { StaffProfileDrawer } from "@/components/staff/staff-profile-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import {
  buildOrgForest,
  collapsibleIds,
  countOrgMatches,
  DEFAULT_EXPANDED_DEPTH,
  defaultCollapsedIds,
  orgChartMatcher,
  pruneOrgForest,
} from "@/lib/staff/org-chart";
import { ROLE_LABELS } from "@/lib/staff/staff-enums";

/**
 * The reporting structure as an indented tree: people as cards, reporting lines as
 * CSS connectors. Built from `staff.managerId` over the same one-shot read the
 * directory grid uses, filtered in memory (the directory's pattern — the `?view=`
 * choice is the only thing that belongs in the URL).
 *
 * **Filtering prunes to matches plus their ancestors** rather than hiding
 * non-matches outright, so the chain from a root down to a match is never broken —
 * seeing *where* a discipline sits in the org is most of the point. Ancestors kept
 * only for that reason render faded and force-expanded.
 *
 * Indented rather than a spreading top-down chart because fan-out is unbounded: a
 * manager with 50 reports is one narrow column here, and a ~5,000px-wide row in the
 * classic layout. Collapse and `+N` do the rest. No virtualization — at company
 * scale the whole org is a few thousand pixels of ordinary page scroll.
 */
export function OrgChart({
  entries,
  lineOfBusinessOptions,
  roleOptions,
}: {
  entries: StaffDirectoryEntry[];
  lineOfBusinessOptions: string[];
  roleOptions: string[];
}) {
  const searchId = useId();
  const inactiveId = useId();
  const [search, setSearch] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const [showInactive, setShowInactive] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const forest = useMemo(() => buildOrgForest(entries), [entries]);

  // A set of COLLAPSED ids, not expanded ones: absence means visible, so nobody can
  // be hidden by a set that forgot to name them. Seeded once from the UNFILTERED
  // forest and never touched by filtering — clearing a filter restores exactly the
  // collapse state you had, rather than whatever the filter unfolded.
  const [collapsed, setCollapsed] = useState(() =>
    defaultCollapsedIds(forest, DEFAULT_EXPANDED_DEPTH),
  );

  // Deliberately excludes `showInactive`. Hiding departed staff is the baseline
  // view, not a narrowing the user asked for — counting it here would force the
  // whole tree open on first load and make collapse unreachable.
  const filtering =
    search.trim() !== "" || lineOfBusiness !== ALL || role !== ALL;

  const pruned = useMemo(
    () =>
      pruneOrgForest(
        forest,
        orgChartMatcher({
          search,
          lineOfBusiness: lineOfBusiness === ALL ? null : lineOfBusiness,
          role: role === ALL ? null : role,
          showInactive,
        }),
      ),
    [forest, search, lineOfBusiness, role, showInactive],
  );

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Matches, not rendered rows — the faded ancestors are context, not results.
  const shown = countOrgMatches(pruned);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-4 items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <FilterLabel htmlFor={searchId}>Name</FilterLabel>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={searchId}
                type="search"
                placeholder="Search by name…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <SelectFilter
            label="Line of business"
            value={lineOfBusiness}
            options={lineOfBusinessOptions}
            labels={LINE_OF_BUSINESS_LABELS}
            onChange={setLineOfBusiness}
            triggerClassName="w-full"
          />
          <SelectFilter
            label="Role"
            value={role}
            options={roleOptions}
            labels={ROLE_LABELS}
            onChange={setRole}
            triggerClassName="w-full"
          />
          <div className="flex h-9 items-center gap-2 text-sm">
            <Switch
              id={inactiveId}
              checked={showInactive}
              onCheckedChange={setShowInactive}
            />
            <label htmlFor={inactiveId}>Show inactive</label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Hidden while filtering: the tree is fully expanded by definition
              then, so these would be two buttons that visibly do nothing. */}
          {filtering ? null : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCollapsed(new Set())}
              >
                Expand all
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCollapsed(new Set(collapsibleIds(forest)))}
              >
                Collapse all
              </Button>
            </>
          )}
          <span className="text-sm text-muted-foreground">
            {/* `shown` excludes the faded context ancestors, and also the departed
                staff the default view hides — so it stays honest either way. */}
            {filtering
              ? `${shown} of ${entries.length} people match`
              : `Showing ${shown} of ${entries.length} people`}
          </span>
        </div>
      </div>

      {pruned.length === 0 ? (
        <EmptyState bordered>No staff match these filters.</EmptyState>
      ) : (
        <nav aria-label="Organization chart" className="overflow-x-auto">
          {/* A semantic nested list, deliberately not an ARIA tree widget: once you
              announce `role="tree"` a screen-reader user is owed roving tabindex,
              arrow-key traversal, Home/End and typeahead, and a half-built one is
              worse than none. Nested <ul>/<li> with a real <button> per node already
              conveys the nesting and is fully Tab-navigable. Roots get a gap because
              no spine crosses it; nested lists must not (see OrgChartNode). */}
          <ul className="flex flex-col gap-4">
            {pruned.map((root) => (
              <OrgChartNode
                key={root.entry.id}
                node={root}
                isRoot
                filtering={filtering}
                collapsed={collapsed}
                onToggle={toggle}
                onSelect={setSelectedId}
              />
            ))}
          </ul>
        </nav>
      )}

      <StaffProfileDrawer
        staffId={selectedId}
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </div>
  );
}
