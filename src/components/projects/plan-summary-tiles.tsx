"use client";

import {
  IconCalendar,
  IconCalendarStats,
  IconCircleCheck,
  IconClock,
  IconUsers,
} from "@tabler/icons-react";
import { useMemo } from "react";
import type { PlanRole } from "@/actions/projects/getOpportunityPlan";
import { StatCard } from "@/components/performance/stat-card";
import {
  type DateRange,
  deliveryManagerLabel,
  rangeLabel,
  rangeOf,
  yearHint,
} from "@/lib/projects/plan-summary";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import {
  PROJECT_ROLE_STATUS_LABELS,
  ROLE_STATUS,
} from "@/lib/projects/project-role-status";

/**
 * The timeline tiles above a project's planner grid: overall length and dates, the
 * confirmed and tentative spans once anything is committed, and (where the surface
 * has nowhere else for them) the delivery managers.
 *
 * Shared by the opportunity's Project-plan tab and the project detail page, which
 * rendered a near-identical copy each. The confirmed/tentative split is the point of
 * the extra tiles: the locked-in timeline reads apart from the proposed one.
 */
export function PlanSummaryTiles({
  roles,
  timeline,
  status,
  lengthWeeks,
  deliveryManagers,
}: {
  roles: PlanRole[];
  timeline: DateRange | null;
  /** The project's derived status, or null when no project is linked yet. */
  status: ProjectRoleStatus | null;
  /** Timeline length in weeks — the planner's column count. */
  lengthWeeks: number;
  /** Omit on surfaces that show the managers elsewhere (the detail page sidebar). */
  deliveryManagers?: { id: string; name: string }[];
}) {
  const confirmedRange = useMemo(
    () => rangeOf(roles.filter((r) => r.status === ROLE_STATUS.confirmed)),
    [roles],
  );
  const tentativeRange = useMemo(
    () => rangeOf(roles.filter((r) => r.status === ROLE_STATUS.tentative)),
    [roles],
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        label="Length"
        value={lengthWeeks ? `${lengthWeeks} wk` : "—"}
        hint={status ? PROJECT_ROLE_STATUS_LABELS[status] : ""}
        icon={IconCalendarStats}
      />
      <StatCard
        label="Dates"
        value={timeline ? rangeLabel(timeline) : "—"}
        hint={timeline ? yearHint(timeline) : undefined}
        icon={IconCalendar}
      />
      {confirmedRange ? (
        <StatCard
          label="Confirmed"
          value={rangeLabel(confirmedRange)}
          hint={yearHint(confirmedRange)}
          icon={IconCircleCheck}
        />
      ) : null}
      {confirmedRange && tentativeRange ? (
        <StatCard
          label="Tentative"
          value={rangeLabel(tentativeRange)}
          hint={yearHint(tentativeRange)}
          icon={IconClock}
        />
      ) : null}
      {deliveryManagers ? (
        <StatCard
          label="Delivery managers"
          value={deliveryManagerLabel(deliveryManagers)}
          icon={IconUsers}
        />
      ) : null}
    </div>
  );
}
