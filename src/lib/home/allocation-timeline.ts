/**
 * Layout geometry for the home dashboard's allocation timeline — a small gantt of
 * the project roles you hold. A pure, client-importable module (no `db`/drizzle, no
 * React) so the component stays render-only, mirroring the split
 * `@/lib/allocations/allocations-grid` uses for the planner.
 *
 * **Rendered as DOM, not SVG.** `docs/ui.md` already made this call for structural
 * diagrams (the org chart is an indented DOM tree — ADR 0054), and a gantt is a
 * schedule, not a plot: the row is mostly text, the project name has to be a link,
 * and SVG can't measure text (see the `LABEL_CHAR_WIDTH` estimation in
 * `compensation-scatter.tsx`). So this module emits **percentages**, which the
 * component hands to CSS custom properties.
 *
 * The window is **centred on now** — the start of last month through the end of
 * month +2 — matching the page's point-in-time framing: enough past to see what
 * just ended, enough future to see what's next, without becoming a forecast. It's
 * deterministic, so month labels are always clean and the whole thing is testable.
 *
 * Bars and axis ticks both position through {@link pctOf}, so a tick can never
 * drift from a bar edge.
 */

import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import type { ProjectRoleType } from "@/lib/projects/project-role-type";
import {
  addDays,
  addMonths,
  eachMonth,
  getMonthStart,
} from "@/lib/timesheets/timesheet-week";

/** Months of history shown before the current month. */
export const TIMELINE_MONTHS_BACK = 1;

/** Months of upcoming work shown after the current month. */
export const TIMELINE_MONTHS_FORWARD = 2;

/** Role rows rendered before the widget defers to the planner. */
export const TIMELINE_MAX_ROWS = 6;

/**
 * Floor on a bar's width, as a percentage of the window. A single-day role is
 * ~0.8% of a four-month window, which rounds away to nothing — this keeps it
 * visible rather than silently absent.
 */
const MIN_BAR_PCT = 1;

/** A full working day — the 100% baseline, matching the allocations planner. */
const HOURS_PER_DAY = 8;

/** The fields the timeline needs from a project role. */
export type TimelineRoleInput = {
  roleId: string;
  projectId: string;
  projectName: string;
  roleType: ProjectRoleType;
  status: ProjectRoleStatus;
  description: string | null;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
};

/** The rendered span, as percentages across the window. */
export type RoleLayout = {
  leftPct: number;
  widthPct: number;
  /** The role began before the window — draw a flat left edge. */
  clippedStart: boolean;
  /** The role runs past the window — draw a flat right edge. */
  clippedEnd: boolean;
};

/** Where a role sits relative to today. */
export type TimelinePhase = "past" | "current" | "upcoming";

/** One rendered row: the role, its nominal load, its phase, and its geometry. */
export type TimelineRow = TimelineRoleInput & {
  /** The role's nominal rate as a share of a full day (`hoursPerDay / 8`), capped. */
  loadPercent: number;
  phase: TimelinePhase;
  layout: RoleLayout;
};

/** The window and its month ticks. */
export type TimelineWindow = {
  start: string;
  end: string;
  /** One tick per month boundary, positioned with the same `pctOf` the bars use. */
  months: { monthStart: string; label: string; pct: number }[];
};

/** Whole-day index since the Unix epoch, computed in UTC to sidestep DST. */
function dayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * Position of a date across the window, 0–100, clamped. Day-resolution: the
 * window's last day starts at `pctOf(end)` and fills through `pctOf(end + 1 day)`,
 * which is 100 — so an inclusive end date renders its own day rather than
 * stopping at its start.
 */
export function pctOf(date: string, window: TimelineWindow): number {
  const from = dayNumber(window.start);
  const span = dayNumber(window.end) + 1 - from;
  if (span <= 0) return 0;
  const pct = ((dayNumber(date) - from) / span) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** Short month tick, e.g. "Aug" — and "Jan '27" when the year turns. */
function monthLabel(monthStart: string, windowStart: string): string {
  const [year, month] = monthStart.split("-").map(Number);
  const short = new Intl.DateTimeFormat("en-US", { month: "short" }).format(
    new Date(year, month - 1, 1),
  );
  const startYear = Number(windowStart.slice(0, 4));
  return year === startYear ? short : `${short} '${String(year).slice(2)}`;
}

/**
 * The window containing `today`: the start of {@link TIMELINE_MONTHS_BACK} months
 * ago through the last day of {@link TIMELINE_MONTHS_FORWARD} months ahead.
 */
export function timelineWindow(today: string): TimelineWindow {
  const start = addMonths(getMonthStart(today), -TIMELINE_MONTHS_BACK);
  const monthCount = TIMELINE_MONTHS_BACK + 1 + TIMELINE_MONTHS_FORWARD;
  const end = addDays(addMonths(start, monthCount), -1);
  const window: TimelineWindow = { start, end, months: [] };
  window.months = eachMonth(start, end).map((monthStart) => ({
    monthStart,
    label: monthLabel(monthStart, start),
    pct: pctOf(monthStart, window),
  }));
  return window;
}

/**
 * Where a role's bar sits, or null when it falls entirely outside the window.
 * Roles crossing an edge are clamped and flagged — the caller still shows the
 * real dates in text, so the clipping is purely visual.
 */
export function layoutRow(
  role: Pick<TimelineRoleInput, "startDate" | "endDate">,
  window: TimelineWindow,
): RoleLayout | null {
  // Guard bad imports rather than rendering a negative-width bar.
  const startDate =
    role.startDate <= role.endDate ? role.startDate : role.endDate;
  const endDate =
    role.startDate <= role.endDate ? role.endDate : role.startDate;
  if (endDate < window.start || startDate > window.end) return null;

  const leftPct = pctOf(startDate, window);
  const rightPct = pctOf(addDays(endDate, 1), window);
  const widthPct = Math.max(MIN_BAR_PCT, rightPct - leftPct);

  return {
    // Keep a min-width bar at the far edge from overflowing the track.
    leftPct: Math.min(leftPct, 100 - widthPct),
    widthPct,
    clippedStart: startDate < window.start,
    clippedEnd: endDate > window.end,
  };
}

function phaseOf(
  role: Pick<TimelineRoleInput, "startDate" | "endDate">,
  today: string,
): TimelinePhase {
  if (role.startDate > today) return "upcoming";
  if (role.endDate < today) return "past";
  return "current";
}

const PHASE_ORDER: Record<TimelinePhase, number> = {
  current: 0,
  upcoming: 1,
  past: 2,
};

/**
 * Lay out and order the rows: what you're on now (heaviest commitment first),
 * then what's coming (soonest first), then what recently ended (most recent
 * first). Capped at {@link TIMELINE_MAX_ROWS}; `hiddenCount` covers both the
 * roles outside the window and the ones the cap dropped, so the footer can say
 * how much it isn't showing rather than silently truncating.
 */
export function buildTimelineRows(
  roles: readonly TimelineRoleInput[],
  today: string,
  window: TimelineWindow,
): { rows: TimelineRow[]; hiddenCount: number } {
  const laid: TimelineRow[] = [];
  let outsideWindow = 0;

  for (const role of roles) {
    const layout = layoutRow(role, window);
    if (!layout) {
      outsideWindow += 1;
      continue;
    }
    laid.push({
      ...role,
      loadPercent: Math.min(
        100,
        Math.round((role.hoursPerDay / HOURS_PER_DAY) * 100),
      ),
      phase: phaseOf(role, today),
      layout,
    });
  }

  const compare = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

  laid.sort((a, b) => {
    if (a.phase !== b.phase) return PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase];
    // Upcoming: soonest start first. Past: most recent end first. Current:
    // heaviest commitment first, then whichever ends soonest.
    if (a.phase === "upcoming") return compare(a.startDate, b.startDate);
    if (a.phase === "past") return compare(b.endDate, a.endDate);
    if (a.loadPercent !== b.loadPercent) return b.loadPercent - a.loadPercent;
    return compare(a.endDate, b.endDate);
  });

  return {
    rows: laid.slice(0, TIMELINE_MAX_ROWS),
    hiddenCount: outsideWindow + Math.max(0, laid.length - TIMELINE_MAX_ROWS),
  };
}
