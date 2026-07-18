import { describe, expect, test } from "bun:test";
import { autofillProjectHours, buildPayload, type Row } from "./timesheet-grid";

// A real Mon→Sun week (2026-07-13 is a Monday; 18th/19th are the weekend).
const WEEK_DAYS = [
  "2026-07-13",
  "2026-07-14",
  "2026-07-15",
  "2026-07-16",
  "2026-07-17",
  "2026-07-18",
  "2026-07-19",
];

function projectRow(projectId: string, hours: Record<string, string>): Row {
  return {
    key: `project:${projectId}`,
    label: projectId,
    sublabel: null,
    projectId,
    category: null,
    hours,
  };
}

describe("buildPayload", () => {
  test("flattens only non-zero weekday cells, carrying each row's target", () => {
    const rows: Row[] = [
      projectRow("proj_1", {
        "2026-07-13": "8",
        "2026-07-14": "0", // zero → dropped
        "2026-07-15": "", // blank → dropped
      }),
      {
        key: "category:PTO",
        label: "PTO",
        sublabel: "Non-billable",
        projectId: null,
        category: "PTO",
        hours: { "2026-07-16": "4" },
      },
    ];

    const payload = buildPayload(rows, WEEK_DAYS, "staff_1", "2026-07-13");

    expect(payload.staffId).toBe("staff_1");
    expect(payload.weekStartDate).toBe("2026-07-13");
    expect(payload.entries).toEqual([
      { date: "2026-07-13", projectId: "proj_1", category: null, hours: 8 },
      { date: "2026-07-16", projectId: null, category: "PTO", hours: 4 },
    ]);
  });

  test("produces no entries for an all-blank grid", () => {
    const rows: Row[] = [projectRow("proj_1", {})];
    const payload = buildPayload(rows, WEEK_DAYS, "staff_1", "2026-07-13");
    expect(payload.entries).toEqual([]);
  });
});

describe("autofillProjectHours", () => {
  test("fills each weekday to the 8h cap and skips weekends when nothing is logged", () => {
    const filled = autofillProjectHours([], WEEK_DAYS, 8);
    expect(filled).toEqual({
      "2026-07-13": "8",
      "2026-07-14": "8",
      "2026-07-15": "8",
      "2026-07-16": "8",
      "2026-07-17": "8",
    });
    // Weekend days are absent.
    expect(filled["2026-07-18"]).toBeUndefined();
    expect(filled["2026-07-19"]).toBeUndefined();
  });

  test("only offers each weekday's remaining capacity and omits full days", () => {
    const existing: Row[] = [
      projectRow("proj_1", {
        "2026-07-13": "3", // 5h remaining
        "2026-07-14": "8", // full → omitted
        "2026-07-15": "10", // over cap → omitted
      }),
    ];

    const filled = autofillProjectHours(existing, WEEK_DAYS, 8);

    expect(filled["2026-07-13"]).toBe("5");
    expect(filled["2026-07-14"]).toBeUndefined();
    expect(filled["2026-07-15"]).toBeUndefined();
    expect(filled["2026-07-16"]).toBe("8");
    expect(filled["2026-07-17"]).toBe("8");
  });
});
