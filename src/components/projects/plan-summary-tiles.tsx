"use client";

import {
  IconCalendar,
  IconCalendarStats,
  IconCircleCheck,
  IconClock,
  IconHeartbeat,
} from "@tabler/icons-react";
import { useMemo } from "react";
import type { PlanRole } from "@/actions/projects/getOpportunityPlan";
import { StatCard } from "@/components/stat-card";
import { formatShortDate, parseIsoDate } from "@/lib/format/format";
import {
  type DateRange,
  rangeLabel,
  rangeOf,
  yearHint,
} from "@/lib/projects/plan-summary";
import {
  PROJECT_HEALTH_MAX,
  projectHealthLabel,
} from "@/lib/projects/project-health";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import {
  PROJECT_ROLE_STATUS_LABELS,
  ROLE_STATUS,
} from "@/lib/projects/project-role-status";

/**
 * The timeline tiles above a project's planner grid: overall length and dates, the
 * confirmed and tentative spans once anything is committed, and — where the surface
 * has one to show — the latest delivery-note health.
 *
 * There was a "Delivery managers" tile here. It went when a delivery manager became
 * an ordinary `DELIVERY` role (ADR 0067): the tile restated a row now visible in the
 * planner grid immediately below, and the detail page had already suppressed it in
 * favour of its sidebar field. What replaced it is a *derived* signal the tiles could
 * never have carried — `DeliveryCoverageNotice`, which fires only when the plan has a
 * hole.
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
  health,
}: {
  roles: PlanRole[];
  timeline: DateRange | null;
  /** The project's derived status, or null when no project is linked yet. */
  status: ProjectRoleStatus | null;
  /** Timeline length in weeks — the planner's column count. */
  lengthWeeks: number;
  /**
   * The latest delivery note's health rating and its date. Omit on surfaces with
   * no delivery notes to read (the opportunity's Project-plan tab); pass
   * `{ value: null }` on a project that simply has none yet, which reads as
   * "Not rated".
   */
  health?: { value: number | null; noteDate: string | null };
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
      {health ? (
        <StatCard
          label="Health"
          value={
            health.value !== null
              ? `${health.value}/${PROJECT_HEALTH_MAX}`
              : projectHealthLabel(null)
          }
          // The date matters as much as the figure: the rating is whatever the last
          // note said, which could be months ago.
          hint={
            health.value !== null
              ? [
                  projectHealthLabel(health.value),
                  health.noteDate
                    ? formatShortDate(parseIsoDate(health.noteDate))
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "No delivery notes yet"
          }
          icon={IconHeartbeat}
        />
      ) : null}
    </div>
  );
}
