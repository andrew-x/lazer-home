import { describe, expect, test } from "bun:test";
import type { PlanRole } from "@/actions/projects/getOpportunityPlan";
import { buildPlannerRows, buildWeekColumns } from "./project-planner-grid";
import {
  PROJECT_ROLE_STATUSES,
  type ProjectRoleStatus,
} from "./project-role-status";

/**
 * Per-role editability in the planner grid. The same rows drive two editors — the
 * opportunity planner (deal-side, tentative-and-mine only) and the project detail
 * page (delivery-side, everything on the project) — so this pins both scopes, plus
 * the `emphasized` flag that keeps the project timeline's confirmed/tentative
 * colouring intact now that every row there is editable.
 */

const THIS_OPPORTUNITY = "opp-1";
const OTHER_OPPORTUNITY = "opp-2";

function role(
  id: string,
  status: ProjectRoleStatus,
  opportunityId: string | null,
): PlanRole {
  return {
    id,
    staffId: null,
    staffName: null,
    lineOfBusiness: "CORE",
    description: null,
    roleType: "ENGINEER",
    status,
    opportunityId,
    billRate: 250,
    startDate: "2026-08-03",
    endDate: "2026-08-14",
    hoursPerDay: 8,
  };
}

/** One role per (status × provenance) combination — the whole editability space. */
function everyCombination(): PlanRole[] {
  const provenances = [THIS_OPPORTUNITY, OTHER_OPPORTUNITY, null];
  return PROJECT_ROLE_STATUSES.flatMap((status) =>
    provenances.map((opportunityId) =>
      role(`${status}:${opportunityId ?? "none"}`, status, opportunityId),
    ),
  );
}

function rowsFor(
  roles: PlanRole[],
  editability: Parameters<typeof buildPlannerRows>[3],
) {
  return buildPlannerRows(roles, [], buildWeekColumns(roles), editability);
}

describe("opportunity scope — only this deal's tentative lines", () => {
  const rows = rowsFor(everyCombination(), {
    scope: "opportunity",
    opportunityId: THIS_OPPORTUNITY,
  });

  test("editable exactly when tentative and tagged with this opportunity", () => {
    for (const row of rows) {
      const [status, provenance] = row.roleId.split(":");
      const expected =
        status === "tentative" && provenance === THIS_OPPORTUNITY;
      expect(row.editable).toBe(expected);
    }
  });

  test("emphasis tracks editability, so this deal's lines stand out", () => {
    for (const row of rows) {
      expect(row.emphasized).toBe(row.editable);
    }
  });

  test("a confirmed role of this opportunity is locked", () => {
    const roles = [role("r1", "confirmed", THIS_OPPORTUNITY)];
    const [row] = rowsFor(roles, {
      scope: "opportunity",
      opportunityId: THIS_OPPORTUNITY,
    });
    expect(row.editable).toBe(false);
  });
});

describe("project scope — every role on the project", () => {
  const roles = everyCombination();
  const rows = rowsFor(roles, { scope: "project" });

  test("every role is editable, whatever its status or provenance", () => {
    expect(rows).toHaveLength(roles.length);
    expect(rows.every((r) => r.editable)).toBe(true);
  });

  test("nothing is emphasised — the block fill falls back to status", () => {
    // Regression guard: keying the fill off `editable` here would flatten
    // confirmed and tentative into one colour on the project timeline.
    expect(rows.some((r) => r.emphasized)).toBe(false);
  });
});
