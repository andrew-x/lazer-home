/**
 * Pure grid math for the **by-project** allocations planner (rows = projects,
 * subrows = their roles, columns = time buckets). A client-importable module (no
 * `db`/drizzle, no React), the sibling of `./allocations-grid` — and it *imports*
 * from that module rather than re-deriving anything, so a role's percentage means
 * exactly the same thing in both views. See docs/domains/allocations.md.
 *
 * The one piece of math that is new here is the **per-project rollup**: a
 * collapsed project row still has to say something useful per column, so each
 * project cell carries the total allocated FTE that bucket plus a count of the
 * roles that are still open.
 */

import type { ProjectAllocationRoleRow } from "@/actions/allocations/getProjectAllocationsGrid";
import { isDeliveryDiscipline } from "@/lib/projects/project-role-type";
import {
  bucketPercent,
  type Granularity,
  getBucketStart,
} from "./allocations-grid";

/** One (role, column) cell: the role's share of that bucket, and its edges. */
export type ProjectRoleCell = {
  /** Share of the column this role takes (0–100); 0 ⇒ the role is idle here. */
  percent: number;
  /** This column is the role's first — its start falls in this bucket. */
  isStart: boolean;
  /** This column is the role's last — its end falls in this bucket. */
  isEnd: boolean;
};

/** A role subrow: the role itself plus its column-aligned cells. */
export type ProjectRoleLine = {
  role: ProjectAllocationRoleRow;
  /** One entry per column in the driving `columns`, in the same order. */
  cells: ProjectRoleCell[];
};

/**
 * A project row's cell: what the whole engagement costs that bucket. `fte` is the
 * summed role percentages as full-time equivalents (200% → 2 FTE), rounded to one
 * decimal; `openCount` is how many of the roles active that bucket have nobody in
 * them. Open roles are counted in `fte` too — the rollup is the *planned* shape of
 * the project, and an unstaffed line is still planned work.
 */
export type ProjectSummaryCell = {
  fte: number;
  openCount: number;
  /**
   * How many roles are running this bucket. The cell's "is anything happening
   * here" test — NOT `fte > 0`, which rounds a sliver of a role (a half-day over
   * one day is 1%) down to zero and would blank a row whose expanded subrows
   * plainly show work.
   */
  roleCount: number;
};

/** A planner row: one project, its role subrows, and its rollup cells. */
export type ProjectAllocationRow = {
  projectId: string;
  projectName: string;
  companyName: string;
  roles: ProjectRoleLine[];
  /** One entry per column in the driving `columns`, in the same order. */
  cells: ProjectSummaryCell[];
  /** True when any role on this project is an open position in the window. */
  hasOpenRole: boolean;
};

/**
 * Fold live project roles into project rows aligned to `columns` at the given
 * `granularity`. Roles are grouped by project; within a project the **delivery
 * line** comes first — it is who runs the engagement rather than another line of
 * work on it — and the rest keep the order they arrive in (the read sorts by start
 * date).
 *
 * A role that is idle in **every** column is dropped — it doesn't touch the
 * planner window — and a project left with no roles is dropped with it, so the
 * date range narrows the grid the same way the other filters do.
 *
 * Rows are ordered to surface staffing gaps: projects carrying an **open role**
 * in the window come first, then everyone else, alphabetically within each group.
 * This is the project-side analogue of the staff view's "most available first".
 */
export function buildProjectAllocationRows(
  roles: readonly ProjectAllocationRoleRow[],
  columns: readonly string[],
  granularity: Granularity,
): ProjectAllocationRow[] {
  const byProject = new Map<string, ProjectRoleLine[]>();

  for (const role of roles) {
    const cells: ProjectRoleCell[] = columns.map((colStart) => ({
      percent: bucketPercent(role, granularity, colStart),
      isStart: getBucketStart(granularity, role.startDate) === colStart,
      isEnd: getBucketStart(granularity, role.endDate) === colStart,
    }));
    // Outside the window entirely — nothing to show on any column.
    if (cells.every((cell) => cell.percent === 0)) continue;

    const lines = byProject.get(role.projectId);
    if (lines) lines.push({ role, cells });
    else byProject.set(role.projectId, [{ role, cells }]);
  }

  const rows: ProjectAllocationRow[] = [];
  for (const lines of byProject.values()) {
    // Delivery first, arrival order otherwise. A stable partition rather than a
    // comparator, so the read's start-date ordering survives among the rest.
    lines.sort(
      (a, b) =>
        Number(isDeliveryDiscipline(b.role.roleType)) -
        Number(isDeliveryDiscipline(a.role.roleType)),
    );
    const first = lines[0].role;
    const cells: ProjectSummaryCell[] = columns.map((_, i) => {
      let percentTotal = 0;
      let openCount = 0;
      let roleCount = 0;
      for (const line of lines) {
        const cell = line.cells[i];
        if (cell.percent === 0) continue;
        percentTotal += cell.percent;
        roleCount += 1;
        if (line.role.staffId === null) openCount += 1;
      }
      return { fte: Math.round(percentTotal / 10) / 10, openCount, roleCount };
    });

    rows.push({
      projectId: first.projectId,
      projectName: first.projectName,
      companyName: first.companyName,
      roles: lines,
      cells,
      hasOpenRole: cells.some((cell) => cell.openCount > 0),
    });
  }

  rows.sort((a, b) => {
    if (a.hasOpenRole !== b.hasOpenRole) return a.hasOpenRole ? -1 : 1;
    return a.projectName.localeCompare(b.projectName);
  });

  return rows;
}
