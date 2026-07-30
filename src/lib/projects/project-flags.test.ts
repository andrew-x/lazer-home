import { describe, expect, test } from "bun:test";
import { addDays } from "@/lib/timesheets/timesheet-week";
import {
  ENDING_SOON_DAYS,
  LOW_MARGIN_AMOUNT,
  LOW_MARGIN_PERCENT,
  type ProjectFlagInputs,
  projectFlags,
} from "./project-flags";

/**
 * The thresholds are policy and will be revised, so every case below is expressed
 * *relative* to the exported constants rather than to 25% / 10,000 — a threshold
 * change should move the boundary these tests probe, not break them.
 */
const TODAY = "2026-07-30";

/** A healthy project: comfortably above both margin floors, ending far out. */
function inputs(overrides: Partial<ProjectFlagInputs> = {}): ProjectFlagInputs {
  return {
    status: "confirmed",
    endDate: addDays(TODAY, 180),
    today: TODAY,
    margin: {
      margin: LOW_MARGIN_AMOUNT * 10,
      marginPercent: LOW_MARGIN_PERCENT * 2,
    },
    ...overrides,
  };
}

/** A margin that clears the amount floor, so only the percentage is in play. */
function atPercent(marginPercent: number) {
  return { margin: LOW_MARGIN_AMOUNT * 10, marginPercent };
}

/** A margin that clears the percentage floor, so only the amount is in play. */
function atAmount(margin: number) {
  return { margin, marginPercent: LOW_MARGIN_PERCENT * 2 };
}

describe("projectFlags", () => {
  test("a healthy project carries no flags", () => {
    expect(projectFlags(inputs())).toEqual([]);
  });

  test("returns flags in canonical worst-first order", () => {
    expect(
      projectFlags(
        inputs({
          endDate: addDays(TODAY, 1),
          margin: { margin: -1, marginPercent: -0.5 },
        }),
      ),
    ).toEqual(["negativeMargin", "endingSoon"]);
  });

  describe("low margin", () => {
    test("trips just below the percentage floor", () => {
      expect(
        projectFlags(inputs({ margin: atPercent(LOW_MARGIN_PERCENT - 0.001) })),
      ).toEqual(["lowMargin"]);
    });

    test("does not trip at the percentage floor", () => {
      expect(
        projectFlags(inputs({ margin: atPercent(LOW_MARGIN_PERCENT) })),
      ).toEqual([]);
    });

    test("trips just below the amount floor", () => {
      expect(
        projectFlags(inputs({ margin: atAmount(LOW_MARGIN_AMOUNT - 1) })),
      ).toEqual(["lowMargin"]);
    });

    test("does not trip at the amount floor", () => {
      expect(
        projectFlags(inputs({ margin: atAmount(LOW_MARGIN_AMOUNT) })),
      ).toEqual([]);
    });

    test("is an OR: a healthy percentage on a small amount still trips", () => {
      expect(
        projectFlags(
          inputs({
            margin: {
              margin: LOW_MARGIN_AMOUNT - 1,
              marginPercent: LOW_MARGIN_PERCENT * 3,
            },
          }),
        ),
      ).toEqual(["lowMargin"]);
    });

    test("is an OR: a large amount at a thin percentage still trips", () => {
      expect(
        projectFlags(
          inputs({
            margin: {
              margin: LOW_MARGIN_AMOUNT * 100,
              marginPercent: LOW_MARGIN_PERCENT / 2,
            },
          }),
        ),
      ).toEqual(["lowMargin"]);
    });

    test("a null percentage (zero revenue) falls back to the amount alone", () => {
      expect(
        projectFlags(
          inputs({
            margin: { margin: LOW_MARGIN_AMOUNT + 1, marginPercent: null },
          }),
        ),
      ).toEqual([]);
      expect(
        projectFlags(
          inputs({
            margin: { margin: LOW_MARGIN_AMOUNT - 1, marginPercent: null },
          }),
        ),
      ).toEqual(["lowMargin"]);
    });
  });

  describe("negative margin", () => {
    test("zero counts as negative, and suppresses low margin", () => {
      expect(
        projectFlags(inputs({ margin: { margin: 0, marginPercent: 0 } })),
      ).toEqual(["negativeMargin"]);
    });

    test("a loss suppresses low margin rather than showing both", () => {
      expect(
        projectFlags(
          inputs({ margin: { margin: -5_000, marginPercent: -0.2 } }),
        ),
      ).toEqual(["negativeMargin"]);
    });

    test("a margin just above zero is low, not negative", () => {
      expect(
        projectFlags(inputs({ margin: { margin: 1, marginPercent: 0.0001 } })),
      ).toEqual(["lowMargin"]);
    });
  });

  describe("unknown margin", () => {
    test("a withheld margin (no viewMargin) yields no margin flags", () => {
      expect(projectFlags(inputs({ margin: null }))).toEqual([]);
    });

    test("an unknown amount (no budget set) yields no margin flags", () => {
      expect(
        projectFlags(inputs({ margin: { margin: null, marginPercent: null } })),
      ).toEqual([]);
    });

    test("a withheld margin still allows the date flag", () => {
      expect(
        projectFlags(inputs({ margin: null, endDate: addDays(TODAY, 3) })),
      ).toEqual(["endingSoon"]);
    });
  });

  describe("ending soon", () => {
    test("trips for a project ending today", () => {
      expect(projectFlags(inputs({ endDate: TODAY }))).toEqual(["endingSoon"]);
    });

    test("trips on the last day of the window", () => {
      expect(
        projectFlags(inputs({ endDate: addDays(TODAY, ENDING_SOON_DAYS) })),
      ).toEqual(["endingSoon"]);
    });

    test("does not trip one day past the window", () => {
      expect(
        projectFlags(inputs({ endDate: addDays(TODAY, ENDING_SOON_DAYS + 1) })),
      ).toEqual([]);
    });

    test("does not trip for a project that has already ended", () => {
      expect(projectFlags(inputs({ endDate: addDays(TODAY, -1) }))).toEqual([]);
    });

    test("does not trip for a project with no roles", () => {
      expect(projectFlags(inputs({ endDate: null }))).toEqual([]);
    });
  });

  describe("cancelled projects", () => {
    test("carry no flags at all", () => {
      expect(
        projectFlags({
          status: "cancelled",
          endDate: addDays(TODAY, 1),
          today: TODAY,
          margin: { margin: -50_000, marginPercent: -1 },
        }),
      ).toEqual([]);
    });

    test("but tentative and paused projects still do", () => {
      for (const status of ["tentative", "paused"] as const) {
        expect(
          projectFlags(
            inputs({ status, endDate: addDays(TODAY, 1), margin: atAmount(0) }),
          ),
        ).toEqual(["negativeMargin", "endingSoon"]);
      }
    });
  });
});
