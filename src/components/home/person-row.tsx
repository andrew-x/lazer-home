import Link from "next/link";
import type { ReactNode } from "react";
import type { AllocationStaffRow } from "@/actions/allocations/getAllocationsGrid";
import { staffMetaLine } from "@/lib/staff/staff-summary";

/**
 * One person in a home-dashboard list: a linked name over a muted
 * "Core · Engineer" sublabel, with an optional right-aligned slot for a date or
 * badge.
 *
 * No avatar — this matches the **allocations planner's** person row, not the
 * staff directory's card. A staffing widget's analogue is the staffing grid, and
 * `getAllocationsGrid` (which feeds these lists) carries no image, so an avatar
 * would mean widening a shared read for decoration.
 */
export function PersonRow({
  staffId,
  name,
  // Named `staffRole`, not `role`: a JSX prop called `role` reads as the ARIA
  // attribute (and the a11y lint treats it as one).
  staffRole,
  lineOfBusiness,
  trailing,
}: {
  staffId: string;
  name: string;
  staffRole: AllocationStaffRow["role"];
  lineOfBusiness: AllocationStaffRow["lineOfBusiness"];
  trailing?: ReactNode;
}) {
  const meta = staffMetaLine({ role: staffRole, lineOfBusiness });
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <div className="flex min-w-0 flex-col">
        <Link
          href={`/staff/${staffId}`}
          className="truncate text-sm font-medium hover:underline"
        >
          {name}
        </Link>
        {meta ? (
          <span className="truncate text-xs text-muted-foreground">{meta}</span>
        ) : null}
      </div>
      {trailing ? (
        <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
