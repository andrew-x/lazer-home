import Link from "next/link";
import type { CSSProperties } from "react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/core/utils";
import { formatShortDate, parseIsoDate } from "@/lib/format/format";
import type {
  TimelineRow,
  TimelineWindow,
} from "@/lib/home/allocation-timeline";
import { PROJECT_ROLE_TYPE_LABELS } from "@/lib/projects/project-role-type";

/**
 * A compact gantt of the roles you hold: project, discipline, load, a span bar,
 * and the real dates.
 *
 * Rendered as **DOM, not SVG** — `docs/ui.md` already settled that for structural
 * diagrams (ADR 0054, the org chart), and a schedule whose rows are mostly linked
 * text is the same case: SVG can't measure text and would force a client boundary
 * for any hover. Geometry comes pre-computed from
 * `@/lib/home/allocation-timeline`; this component only places it, passing the two
 * dynamic values as CSS custom properties (the vendored `ToggleGroup`/`Card`
 * precedent) rather than as inline `left`/`width`.
 */
export function AllocationTimeline({
  rows,
  window,
  todayPct,
  hiddenCount,
}: {
  rows: TimelineRow[];
  window: TimelineWindow;
  todayPct: number;
  hiddenCount: number;
}) {
  const windowLabel = `${formatShortDate(parseIsoDate(window.start))} – ${formatShortDate(parseIsoDate(window.end))}`;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Your allocations</CardTitle>
        <CardAction>
          <Link
            href="/allocations"
            className="text-sm text-primary hover:underline"
          >
            Open the planner
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.length === 0 ? (
          <EmptyState>
            You have no allocations between {windowLabel}.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,9rem)_auto_2.5rem_minmax(6rem,1fr)_auto]">
            {rows.map((row) => (
              <TimelineRowCells
                key={row.roleId}
                row={row}
                todayPct={todayPct}
              />
            ))}
            <TimelineAxis window={window} todayPct={todayPct} />
          </div>
        )}
        {hiddenCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {hiddenCount} more {hiddenCount === 1 ? "role" : "roles"} outside
            this view ·{" "}
            <Link href="/allocations" className="text-primary hover:underline">
              open the planner
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * The five cells of one row, emitted as a fragment so they inherit the parent
 * grid's column tracks. The discipline, load and bar cells collapse below `sm`:
 * a four-month bar at 320px is decorative noise, and the dates carry the same
 * information.
 */
function TimelineRowCells({
  row,
  todayPct,
}: {
  row: TimelineRow;
  todayPct: number;
}) {
  const past = row.phase === "past";
  const dates = row.layout.clippedStart
    ? `→ ${formatShortDate(parseIsoDate(row.endDate))}`
    : `${formatShortDate(parseIsoDate(row.startDate))} → ${formatShortDate(parseIsoDate(row.endDate))}`;

  return (
    <>
      <div
        className={cn(
          "flex min-w-0 items-center gap-1.5",
          past && "opacity-60",
        )}
      >
        <Link
          href={`/projects/${row.projectId}`}
          className="truncate text-sm font-medium hover:underline"
        >
          {row.projectName}
        </Link>
        {row.status === "tentative" ? (
          <Badge variant="secondary" className="shrink-0 font-normal">
            Tentative
          </Badge>
        ) : null}
      </div>

      <div
        className={cn(
          "hidden truncate text-xs text-muted-foreground sm:block",
          past && "opacity-60",
        )}
      >
        {PROJECT_ROLE_TYPE_LABELS[row.roleType]}
      </div>

      <div
        className={cn(
          "hidden text-right text-xs tabular-nums text-muted-foreground sm:block",
          past && "opacity-60",
        )}
      >
        {row.loadPercent}%
      </div>

      <div className="relative hidden h-2 rounded-sm bg-muted/60 sm:block">
        <span
          aria-hidden
          style={{ "--today": `${todayPct}%` } as CSSProperties}
          className="absolute -inset-y-1 left-(--today) w-px bg-foreground/30"
        />
        <span
          title={`${dates} · ${row.status === "confirmed" ? "Confirmed" : "Tentative"}`}
          style={
            {
              "--bar-left": `${row.layout.leftPct}%`,
              "--bar-width": `${row.layout.widthPct}%`,
            } as CSSProperties
          }
          className={cn(
            "absolute inset-y-0 left-(--bar-left) w-(--bar-width) rounded-sm",
            row.status === "confirmed"
              ? "border border-primary/40 bg-primary/25"
              : "border border-dashed border-primary/50 bg-primary/[0.06]",
            row.layout.clippedStart && "rounded-l-none border-l-0",
            row.layout.clippedEnd && "rounded-r-none border-r-0",
            past && "opacity-50",
          )}
        />
      </div>

      <div
        className={cn(
          "whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground",
          past && "opacity-60",
        )}
      >
        {dates}
      </div>
    </>
  );
}

/**
 * Month ticks under the bars. Positioned with the same `pctOf` the bars use
 * (the pre-computed `window.months[].pct`), so a tick can never drift from a bar
 * edge. Occupies only the track column, and only from `sm` up.
 */
function TimelineAxis({
  window,
  todayPct,
}: {
  window: TimelineWindow;
  todayPct: number;
}) {
  return (
    <>
      {/* Spacers for the three label columns; the axis starts under the track. */}
      <div className="hidden sm:col-span-3 sm:block" />
      <div className="relative hidden h-4 border-t sm:block">
        {window.months.map((month) => (
          <span
            key={month.monthStart}
            style={{ "--tick": `${month.pct}%` } as CSSProperties}
            className="absolute left-(--tick) pl-1 text-[11px] text-muted-foreground"
          >
            {month.label}
          </span>
        ))}
        <span
          aria-hidden
          style={{ "--today": `${todayPct}%` } as CSSProperties}
          className="absolute -top-1 left-(--today) h-1 w-px bg-foreground/30"
        />
      </div>
      <div className="hidden sm:block" />
    </>
  );
}
