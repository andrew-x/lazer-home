"use client";

import { IconPencil } from "@tabler/icons-react";
import { parseIsoDate } from "@/lib/format";
import {
  type PlannerRow,
  type RoleSegment,
  weekColumnLabel,
} from "@/lib/project-planner-grid";
import { PROJECT_ROLE_TYPE_LABELS } from "@/lib/project-role-type";
import { cn } from "@/lib/utils";

/** The block style for a week cell, by the covering segment's state. */
function segmentClass(segment: RoleSegment): string {
  // This deal's editable segments carry the indigo accent so they stand out
  // from the neutral-grey read-only blocks and the empty (unallocated) cells.
  if (segment.editable) return "bg-primary";
  if (segment.status === "confirmed") return "bg-foreground/25";
  return "bg-foreground/10"; // tentative, from another opportunity
}

export function PlannerGrid({
  rows,
  weekColumns,
  onEditRole,
}: {
  rows: PlannerRow[];
  weekColumns: string[];
  onEditRole?: (roleId: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      {/* Raw <table> on purpose — NOT @/components/ui/table. This is the app's
          only hand-rolled table: a Gantt/planner grid with a sticky first
          column and week columns whose per-cell layout the shared Table
          primitives don't model. Don't "fix" this to use the UI Table or copy
          this pattern for ordinary data tables. */}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <th className="sticky left-0 z-10 min-w-56 bg-background px-3 py-2 text-left font-medium">
              Role
            </th>
            {weekColumns.map((week) => (
              <th
                key={week}
                className="min-w-14 px-1 py-2 text-center text-xs font-medium text-muted-foreground"
              >
                {weekColumnLabel(week)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b last:border-b-0">
              <td className="sticky left-0 z-10 bg-background px-3 py-2 align-top">
                <div className="font-medium">{row.label}</div>
                <div className="text-xs text-muted-foreground">
                  {row.sublabel}
                  {row.sublabel ? " · " : ""}
                  {allocationLabel(row)}
                </div>
                {/* An explicit edit control per editable segment — the sole edit
                    surface, so a segment fully contained by another (same
                    person) is still reachable. */}
                {onEditRole ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.segments
                      .filter((s) => s.editable)
                      .map((s) => (
                        <button
                          key={s.roleId}
                          type="button"
                          onClick={() => onEditRole(s.roleId)}
                          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                        >
                          <IconPencil className="size-3" />
                          {shortRange(s.startDate, s.endDate)}
                        </button>
                      ))}
                  </div>
                ) : null}
              </td>
              {weekColumns.map((week, i) => {
                const segment = row.active[i]
                  ? coveringSegment(row, week)
                  : null;
                return (
                  <td key={week} className="px-0.5 py-2">
                    {segment ? (
                      <BlockCell segment={segment} />
                    ) : (
                      <div className="h-6" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A single filled week cell — a visual block; editing is via the label controls. */
function BlockCell({ segment }: { segment: RoleSegment }) {
  return (
    <div
      className={cn("h-6 w-full rounded-none", segmentClass(segment))}
      title={`${PROJECT_ROLE_TYPE_LABELS[segment.roleType]} · ${segment.hoursPerDay}h/day${segment.status === "confirmed" ? " · confirmed" : ""}`}
    />
  );
}

/** "Aug 3 – Aug 16" from two ISO dates, for the per-segment edit control. */
function shortRange(start: string, end: string): string {
  const fmt = (d: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(parseIsoDate(d));
  return `${fmt(start)} – ${fmt(end)}`;
}

/** The distinct daily-hours across a row's segments, e.g. "8h/day" or "8/4h/day". */
function allocationLabel(row: PlannerRow): string {
  const hours: number[] = [];
  for (const s of row.segments) {
    if (!hours.includes(s.hoursPerDay)) hours.push(s.hoursPerDay);
  }
  return `${hours.join("/")}h/day`;
}

/**
 * A segment of `row` covering `week`, for styling that week's cell. Prefers an
 * editable segment when several overlap, so an editable role contained within a
 * greyed one still reads as "this deal" on its own weeks.
 */
function coveringSegment(row: PlannerRow, week: string): RoleSegment | null {
  const covering = row.segments.filter(
    (s) => week >= s.startWeek && week <= s.endWeek,
  );
  return covering.find((s) => s.editable) ?? covering[0] ?? null;
}

export function PlannerLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="size-3 rounded-none bg-primary" />
        This deal (editable)
      </span>
      <span className="flex items-center gap-1">
        <span className="size-3 rounded-none bg-foreground/25" />
        Confirmed
      </span>
      <span className="flex items-center gap-1">
        <span className="size-3 rounded-none bg-foreground/10" />
        Other deal
      </span>
    </div>
  );
}
