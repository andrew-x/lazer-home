"use client";

import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useId } from "react";
import { IconButton } from "@/components/icon-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/core/utils";
import { initialsFor } from "@/lib/format/format";
import type {
  OrgChartNode as OrgNode,
  OrgRootReason,
} from "@/lib/staff/org-chart";
import { staffMetaLine } from "@/lib/staff/staff-summary";

/**
 * Horizontal metrics, all interlocking — change one and you must change its pair.
 * The `<li>` is `relative`, so every `left-*` below resolves against **the li's own
 * left edge**, not the list's. The nested `<ul>`'s `pl-3` is what puts that edge
 * under the parent's chevron centre (parent content-left + 12 = half of `size-6`),
 * and it is already baked in here — don't add it again.
 *
 * ```
 * x=0    spine  (== parent's chevron centre)
 * x=0    ├──── elbow ────┤
 * x=24                   [chevron / spacer, size-6]     <- pl-6 gutter ends here
 * x=56                                      [card, w-72 ───────────>
 * ```
 *
 * So `w-6` (24px) lands on the chevron's left edge, and `w-14` (56px) runs the
 * extra `size-6 + gap-2` to the card's. A row with no chevron takes the long one —
 * otherwise the line stops in whitespace and the card reads as unattached.
 */
const ELBOW_TO_CHEVRON = "after:w-6";
const ELBOW_TO_CARD = "after:w-14";

/**
 * The stub joining a parent's chevron to the top of its children's spine. Without
 * it the spine starts at the children list's top edge — 20px below the chevron —
 * and the whole subtree reads as floating rather than hanging off its parent.
 *
 * `-top-5` is that 20px: half the parent's `h-16` row (32) puts us at the chevron's
 * centre, plus half of `size-6` (12) to clear its bottom edge. `left-3` matches the
 * list's own `pl-3`, so the stub is colinear with the spine below it.
 */
const CHILD_LIST_STUB =
  "relative before:absolute before:left-3 before:-top-5 before:h-5 before:w-px before:bg-border";

/**
 * Connector geometry for one child row. `::before` is the vertical spine segment,
 * `::after` the horizontal elbow stub.
 *
 * `after:top-8` and `last:before:h-8` are BOTH half the row height (`h-16`): the
 * elbow meets the card's vertical centre, and on the last child the spine stops
 * dead at that elbow instead of running past it into empty space. Change one,
 * change both.
 *
 * The two `::before` cases are written as DISJOINT selectors (`:not(:last-child)`
 * vs `:last-child`) rather than a `last:` override of a base `bottom-0`, so the
 * result never depends on Tailwind's variant sort order.
 *
 * Concatenated literals only — never interpolate into a class string, or Tailwind
 * v4's source scanner won't emit these candidates.
 */
const CONNECTOR =
  "pl-6 " +
  "before:absolute before:left-0 before:top-0 before:w-px before:bg-border " +
  "[&:not(:last-child)]:before:bottom-0 " +
  "last:before:h-8 " +
  "after:absolute after:left-0 after:top-8 after:h-px after:bg-border";

/** What each malformed-edge root reason says on its badge. */
const ROOT_REASON_LABELS: Record<Exclude<OrgRootReason, "top">, string> = {
  self: "Reports to self",
  orphan: "Manager not listed",
  cycle: "Reporting loop",
};

/**
 * One person in the org chart, plus their reports. Recursive: an `<li>` carrying
 * the connector pseudo-elements, a fixed-height row (disclosure · card · count),
 * and a nested `<ul>` of the same component.
 *
 * Expansion is **derived, not owned**. While a filter is active every surviving
 * node renders open and drops its disclosure control: the prune has already
 * reduced the tree to matches and the chains leading to them, so *any* node still
 * holding reports has a match underneath it, and letting one stay collapsed would
 * hide the very results the filter exists to surface. With no filter active,
 * everyone honours the caller's `collapsed` set — which is never mutated by
 * filtering, so clearing a filter restores exactly the shape the user left.
 */
export function OrgChartNode({
  node,
  isRoot = false,
  filtering,
  collapsed,
  onToggle,
  onSelect,
}: {
  node: OrgNode;
  isRoot?: boolean;
  /** Whether any filter is narrowing the tree — see the expansion note above. */
  filtering: boolean;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const groupId = useId();
  const { entry } = node;
  const hasReports = node.reports.length > 0;
  const expanded = filtering || !collapsed.has(entry.id);
  const showToggle = hasReports && !filtering;
  const meta = staffMetaLine({
    lineOfBusiness: entry.lineOfBusiness,
    role: entry.role,
  });

  return (
    <li
      className={cn(
        "relative",
        !isRoot && CONNECTOR,
        // Keyed on whether a chevron is actually RENDERED, not on whether the node
        // has reports — a filtered-in ancestor has reports but shows a spacer, and
        // would otherwise get the short elbow and a visually detached card.
        !isRoot && (showToggle ? ELBOW_TO_CHEVRON : ELBOW_TO_CARD),
      )}
    >
      <div className="flex h-16 items-center gap-2">
        {showToggle ? (
          <IconButton
            label={
              expanded
                ? `Collapse ${entry.name}'s reports`
                : `Expand ${entry.name}'s reports (${node.descendantCount})`
            }
            size="icon-xs"
            aria-expanded={expanded}
            // Only while the list is actually mounted — an IDREF pointing at a
            // node that isn't in the DOM is worse than no IDREF at all.
            aria-controls={expanded ? groupId : undefined}
            className="shrink-0"
            onClick={() => onToggle(entry.id)}
          >
            {expanded ? <IconChevronDown /> : <IconChevronRight />}
          </IconButton>
        ) : (
          // A spacer, not a disabled button — leaves keep their cards aligned with
          // their siblings' without adding a dead stop to the tab order.
          <span aria-hidden className="size-6 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onSelect(entry.id)}
          className={cn(
            "flex h-14 w-72 shrink-0 items-center gap-3 rounded-md border bg-background px-3 text-left transition-colors hover:bg-accent",
            !entry.isActive && "border-dashed bg-muted/30",
            // Faded because it is context rather than a result. Opacity says
            // nothing to a screen reader, so the sr-only note below carries it.
            node.passThrough && "opacity-60 hover:opacity-100",
          )}
        >
          <Avatar
            className={cn("size-8", !entry.isActive && "opacity-50 grayscale")}
          >
            {entry.imageUrl ? (
              <AvatarImage src={entry.imageUrl} alt="" />
            ) : null}
            <AvatarFallback className="text-xs">
              {initialsFor(entry.name, entry.email)}
            </AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{entry.name}</span>
            {meta ? (
              <span className="truncate text-xs text-muted-foreground">
                {meta}
              </span>
            ) : null}
          </span>
          {node.passThrough ? (
            <span className="sr-only">
              — shown for context; does not match the filters
            </span>
          ) : null}
        </button>

        {hasReports && !expanded ? (
          <Badge variant="secondary" className="shrink-0">
            +{node.descendantCount}
          </Badge>
        ) : null}
        {!entry.isActive ? (
          <Badge variant="outline" className="shrink-0">
            Inactive
          </Badge>
        ) : null}
        {node.rootReason && node.rootReason !== "top" ? (
          // The only surface in the app that shows a malformed reporting edge —
          // the CSV import merely warns, and nothing has ever displayed the result.
          <Badge variant="outline" className="shrink-0">
            {ROOT_REASON_LABELS[node.rootReason]}
          </Badge>
        ) : null}
      </div>

      {hasReports && expanded ? (
        // `pl-3` puts the child spine under this node's chevron centre, and NO
        // `gap` is load-bearing: any gap between siblings breaks the spine into
        // dashes. The vertical rhythm is the row's `h-16`, not a gap.
        <ul id={groupId} className={cn("flex flex-col pl-3", CHILD_LIST_STUB)}>
          {node.reports.map((report) => (
            <OrgChartNode
              key={report.entry.id}
              node={report}
              filtering={filtering}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
