import { IconAlertTriangle } from "@tabler/icons-react";
import { InlineNotice } from "@/components/inline-notice";
import { formatDateRange } from "@/lib/format/format";
import type { DeliveryCoverageGap } from "@/lib/projects/delivery-coverage";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";

/** How many gap ranges to list before collapsing the rest to "+N more". */
const MAX_LISTED_GAPS = 3;

/**
 * Warns that some working period of the project has no delivery manager on it — the
 * one thing the old `project_delivery_managers` junction structurally could not tell
 * you, because it carried no dates (ADR 0067).
 *
 * **Rendered above the tabs**, for the same reason `BudgetSummaryPanel` is: a
 * coverage gap is a fact about the plan as a whole, not about any one tab, and the
 * fix — add or extend a delivery role — is reachable from both the Timeline and the
 * Roles tab, so scoping the warning to one of them would be arbitrary.
 *
 * `tone="muted"`, not `destructive`. `PROJECT_FLAG_VARIANTS` reserves colour for a
 * loss, and `lowHealth` is neutral there despite being the strongest signal on a
 * list row. A coverage gap is not money, and its commonest cause is a delivery role
 * nobody extended when the engagement slipped. The precedent is
 * `budget-summary-panel.tsx`'s incomplete-cost notice: a muted `IconAlertTriangle`
 * about the plan's *completeness*, which is exactly what this is.
 *
 * Unlike the projects list's `noDeliveryManager` flag, this shows **past** gaps too.
 * The list suppresses them so finished engagements don't carry permanent badges; this
 * page is the delivery-side editor, where a historical hole is either a data error to
 * fix or a fact worth knowing.
 *
 * Not a Client Component (mirroring `InlineNotice`'s own deliberate choice), so it
 * stays droppable into a Server Component.
 */
export function DeliveryCoverageNotice({
  gaps,
  timeline,
  status,
  canEdit,
}: {
  gaps: DeliveryCoverageGap[];
  /** The project's overall span, for recognising a wholly uncovered plan. */
  timeline: { start: string; end: string } | null;
  /** The project's derived status — a cancelled plan says nothing. */
  status: ProjectRoleStatus;
  canEdit: boolean;
}) {
  // A cancelled project will never be delivered, so nobody has to run it — the same
  // `isLive` rule the list flags use.
  if (gaps.length === 0 || status === "cancelled") return null;

  const ranges = gaps.map((gap) => formatDateRange(gap.startDate, gap.endDate));
  const listed = ranges.slice(0, MAX_LISTED_GAPS);
  const hidden = ranges.length - listed.length;

  // One gap covering the entire timeline collapses two cases into one true
  // sentence: no delivery role at all, and a delivery role sitting outside the
  // project's dates.
  const wholeProject =
    gaps.length === 1 &&
    timeline !== null &&
    gaps[0].startDate <= timeline.start &&
    gaps[0].endDate >= timeline.end;

  return (
    <InlineNotice icon={IconAlertTriangle}>
      {wholeProject ? (
        <p>
          No delivery manager on this project.
          {canEdit
            ? " Add a Delivery role to name who owns the engagement."
            : null}
        </p>
      ) : ranges.length === 1 ? (
        <p>
          No delivery manager covers {ranges[0]}.
          {canEdit ? " Add or extend a Delivery role to cover it." : null}
        </p>
      ) : (
        <>
          <p>
            No delivery manager covers {ranges.length} periods of this project:
          </p>
          {/* Same truncation contract as the list's Risk and Line-of-business
              cells: show the first few, collapse the rest, full set in `title`. */}
          <ul className="mt-1 flex flex-col gap-1" title={ranges.join("; ")}>
            {listed.map((range) => (
              <li key={range}>{range}</li>
            ))}
            {hidden > 0 ? (
              <li className="text-muted-foreground">and {hidden} more</li>
            ) : null}
          </ul>
          {canEdit ? (
            <p className="mt-1">Add or extend a Delivery role to cover them.</p>
          ) : null}
        </>
      )}
    </InlineNotice>
  );
}
