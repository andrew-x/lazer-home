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

describe("row order — the delivery line always leads", () => {
  /** A role with a name and a discipline, for readable ordering assertions. */
  function named(
    id: string,
    roleType: PlanRole["roleType"],
    staffName: string | null,
  ): PlanRole {
    return {
      ...role(id, "confirmed", null),
      roleType,
      staffId: staffName === null ? null : `staff-${id}`,
      staffName,
    };
  }

  const order = (roles: PlanRole[]) =>
    rowsFor(roles, { scope: "project" }).map((r) => r.roleId);

  test("delivery leads a staffed role, whatever the names say", () => {
    // "Zoe" would sort last alphabetically; running the engagement outranks that.
    expect(
      order([named("eng", "ENGINEER", "Amy"), named("dm", "DELIVERY", "Zoe")]),
    ).toEqual(["dm", "eng"]);
  });

  test("an OPEN delivery role still leads a staffed engineer", () => {
    // Deliberate: the seat's place in the plan doesn't depend on it being filled,
    // and the open-role sort below must not pull it back down.
    expect(
      order([named("eng", "ENGINEER", "Amy"), named("dm", "DELIVERY", null)]),
    ).toEqual(["dm", "eng"]);
  });

  test("a cancelled delivery role still leads — it is a kind, not a status", () => {
    expect(
      order([
        named("eng", "ENGINEER", "Amy"),
        { ...named("dm", "DELIVERY", "Zoe"), status: "cancelled" },
      ]),
    ).toEqual(["dm", "eng"]);
  });

  test("two delivery lines lead, then the rest keep their own ordering", () => {
    expect(
      order([
        named("open", "QA", null),
        named("eng-b", "ENGINEER", "Bob"),
        named("dm-z", "DELIVERY", "Zoe"),
        named("eng-a", "ENGINEER", "Amy"),
        named("dm-a", "DELIVERY", "Ann"),
      ]),
    ).toEqual(["dm-a", "dm-z", "eng-a", "eng-b", "open"]);
  });

  test("isDelivery is set on exactly the delivery rows", () => {
    const rows = rowsFor(
      [named("dm", "DELIVERY", "Zoe"), named("eng", "ENGINEER", "Amy")],
      { scope: "project" },
    );
    expect(rows.map((r) => [r.roleId, r.isDelivery])).toEqual([
      ["dm", true],
      ["eng", false],
    ]);
  });
});
