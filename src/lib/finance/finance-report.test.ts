import { describe, expect, test } from "bun:test";
import type { Currency } from "@/lib/format/currency";
import type { MarginBilling } from "@/lib/projects/project-margin";
import {
  buildFinanceReport,
  clipRoleToWindow,
  type FinanceProjectInput,
  type FinanceRoleInput,
  feeRecognitionShare,
} from "./finance-report";

/**
 * Invariants for the portfolio finance math — the ones the type checker cannot
 * express, each of which would otherwise produce a plausible-looking wrong number
 * on a page people price work from.
 *
 * 1. **A prorated fee partitions.** Contiguous windows over a fixed-fee plan must
 *    sum back to exactly the fee — that property is what makes proration a
 *    recognition schedule rather than a number we invented. Likewise the practices
 *    of a multi-practice plan: if each per-practice view claimed the whole fee, the
 *    line-of-business filter would silently multiply revenue by five.
 * 2. **Partial is not smaller.** A role with no cost basis and a project with no
 *    billing type must leave a total *partial*, with a tally saying so — never
 *    quietly deflate it, and never read as zero.
 * 3. **A percentage is currency-invariant.** Amounts move with the display
 *    currency; margin percentages must not, or the same portfolio is profitable in
 *    one currency and not the other.
 * 4. **Nothing divides by zero into a confident answer.** An empty portfolio and a
 *    zero-hour discipline report `null`, not `NaN`, `Infinity` or a triumphant 100%.
 *
 * Calendar anchors used throughout — August and September 2026, hand-counted:
 *   Aug 2026 starts Sat 1st  → 21 weekdays (Aug 1–31)
 *   Sep 2026 starts Tue 1st  → 22 weekdays (Sep 1–30)
 * So a role spanning Aug 1 – Sep 30 at 8h/day has 43 × 8 = 344 billable hours.
 */

const AUGUST = { start: "2026-08-01", end: "2026-08-31" };
const SEPTEMBER = { start: "2026-09-01", end: "2026-09-30" };
const BOTH_MONTHS = { start: "2026-08-01", end: "2026-09-30" };

const AUGUST_HOURS = 21 * 8;
const SEPTEMBER_HOURS = 22 * 8;
const TOTAL_HOURS = AUGUST_HOURS + SEPTEMBER_HOURS;

/**
 * A role's span confined to August, for `role({ ...IN_AUGUST })`. Spelled out
 * rather than spreading `AUGUST`, whose keys are `start`/`end` (a window) not
 * `startDate`/`endDate` (a role) — spreading the window sets neither and leaves the
 * default two-month span in place, which the in-period clip then hides.
 */
const IN_AUGUST = { startDate: AUGUST.start, endDate: AUGUST.end };

/**
 * Round USD-based rates so every converted figure is checkable by hand: 1 USD = 2
 * CAD. Fake, and deliberately not near the real rate — a test that passes only
 * because 1.37 ≈ 1 would be no test at all.
 */
const RATES: Record<Currency, number> = {
  USD: 1,
  CAD: 2,
  GBP: 1,
  EUR: 1,
  AED: 1,
};

/** The standard rate card figure, so roles are on-card unless a test says otherwise. */
const CARD_RATE = 250;

function role(overrides: Partial<FinanceRoleInput> = {}): FinanceRoleInput {
  return {
    roleId: "role_1",
    roleType: "ENGINEER",
    status: "confirmed",
    lineOfBusiness: "CORE",
    startDate: BOTH_MONTHS.start,
    endDate: BOTH_MONTHS.end,
    hoursPerDay: 8,
    billRate: CARD_RATE,
    staffId: "staff_1",
    staffHourlyCost: { amount: 100, currency: "USD" },
    ...overrides,
  };
}

function project(
  overrides: Partial<FinanceProjectInput> = {},
): FinanceProjectInput {
  const billing: MarginBilling = {
    billingType: "TIME_AND_MATERIALS",
    budgetAmount: null,
    budgetCurrency: null,
  };
  return {
    id: "proj_1",
    name: "Project One",
    companyId: "co_1",
    companyName: "Acme",
    billing,
    roles: [role()],
    ...overrides,
  };
}

const FIXED_FEE: MarginBilling = {
  billingType: "FIXED_FEE",
  budgetAmount: 100_000,
  budgetCurrency: "USD",
};

function build({
  projects,
  range = AUGUST,
  displayCurrency = "USD" as const,
  includeCost = true,
  lineOfBusiness = null,
}: {
  projects: FinanceProjectInput[];
  range?: { start: string; end: string };
  displayCurrency?: "USD" | "CAD";
  includeCost?: boolean;
  lineOfBusiness?: "CORE" | "FINTECH" | null;
}) {
  return buildFinanceReport({
    range,
    projects,
    // ENGINEER present so an open ENGINEER role costs; DESIGNER absent so an open
    // DESIGNER role has no basis at all — the two cases tested below.
    openRoleCostUsd: { ENGINEER: 90 },
    displayCurrency,
    usdRates: RATES,
    includeCost,
    lineOfBusiness,
  });
}

describe("clipRoleToWindow", () => {
  test("narrows an overlapping role and drops a disjoint one", () => {
    const spanning = role();
    expect(clipRoleToWindow(spanning, AUGUST)).toMatchObject({
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });

    // Wholly before, and wholly after. Null rather than a zero-hour role: an
    // inclusive date pair cannot express "no days".
    expect(
      clipRoleToWindow(role({ endDate: "2026-07-31" }), AUGUST),
    ).toBeNull();
    expect(
      clipRoleToWindow(role({ startDate: "2026-09-01" }), AUGUST),
    ).toBeNull();
  });

  test("keeps a role narrower than the window at its own dates", () => {
    const short = role({ startDate: "2026-08-10", endDate: "2026-08-14" });
    expect(clipRoleToWindow(short, AUGUST)).toMatchObject({
      startDate: "2026-08-10",
      endDate: "2026-08-14",
    });
  });
});

describe("feeRecognitionShare", () => {
  test("contiguous windows partition the fee exactly", () => {
    const roles = [role()];
    const august = feeRecognitionShare({
      roles,
      allRoles: roles,
      window: AUGUST,
    });
    const september = feeRecognitionShare({
      roles,
      allRoles: roles,
      window: SEPTEMBER,
    });

    expect(august).toBeCloseTo(AUGUST_HOURS / TOTAL_HOURS, 10);
    expect(september).toBeCloseTo(SEPTEMBER_HOURS / TOTAL_HOURS, 10);
    // The property that makes this a recognition schedule rather than a guess.
    expect(august + september).toBeCloseTo(1, 10);
  });

  test("a slice divides by the WHOLE plan, so practices partition too", () => {
    const core = role({ roleId: "r_core", lineOfBusiness: "CORE" });
    const fintech = role({ roleId: "r_fin", lineOfBusiness: "FINTECH" });
    const allRoles = [core, fintech];

    // Equal spans ⇒ half each. Were the denominator the slice's own hours, both
    // would be 1 and the two practice views would each claim the entire fee.
    expect(feeRecognitionShare({ roles: [core], allRoles })).toBeCloseTo(
      0.5,
      10,
    );
    expect(feeRecognitionShare({ roles: [fintech], allRoles })).toBeCloseTo(
      0.5,
      10,
    );
    expect(feeRecognitionShare({ roles: allRoles, allRoles })).toBe(1);
  });

  test("cancelled roles are outside the fee on both sides of the ratio", () => {
    const live = role({ roleId: "r_live" });
    const dead = role({ roleId: "r_dead", status: "cancelled" });
    // The cancelled role must not dilute the live one's share to 0.5.
    expect(feeRecognitionShare({ roles: [live], allRoles: [live, dead] })).toBe(
      1,
    );
    // A plan of nothing but cancelled work recognizes nothing — not everything.
    expect(feeRecognitionShare({ roles: [dead], allRoles: [dead] })).toBe(0);
  });
});

describe("buildFinanceReport — windowing", () => {
  test("in-period revenue is the rate times the weekdays inside the window", () => {
    const report = build({ projects: [project()] });

    // 21 August weekdays × 8h × $250 = $42,000, against 344h × $250 overall.
    expect(report.inPeriod.hours).toBe(AUGUST_HOURS);
    expect(report.inPeriod.revenue).toBeCloseTo(AUGUST_HOURS * CARD_RATE, 6);
    expect(report.overall.hours).toBe(TOTAL_HOURS);
    expect(report.overall.revenue).toBeCloseTo(TOTAL_HOURS * CARD_RATE, 6);
  });

  test("a role outside the window adds nothing in-period but counts overall", () => {
    const inside = role({ roleId: "r_in", ...IN_AUGUST });
    const outside = role({
      roleId: "r_out",
      startDate: "2026-11-02",
      endDate: "2026-11-30",
    });
    const report = build({
      projects: [project({ roles: [inside, outside] })],
    });

    expect(report.inPeriod.hours).toBe(AUGUST_HOURS);
    expect(report.inPeriod.roleCount).toBe(1); // "roles active in the period"
    // November 2026: Mon 2nd – Mon 30th is 21 weekdays.
    expect(report.overall.hours).toBe(AUGUST_HOURS + 21 * 8);
    expect(report.overall.roleCount).toBe(2);
  });

  test("a whole fixed fee is recognized across contiguous windows, never twice", () => {
    const plan = project({ billing: FIXED_FEE });
    const august = build({ projects: [plan], range: AUGUST });
    const september = build({ projects: [plan], range: SEPTEMBER });
    const both = build({ projects: [plan], range: BOTH_MONTHS });

    expect(august.inPeriod.revenue).toBeCloseTo(
      100_000 * (AUGUST_HOURS / TOTAL_HOURS),
      6,
    );
    expect(
      (august.inPeriod.revenue ?? 0) + (september.inPeriod.revenue ?? 0),
    ).toBeCloseTo(100_000, 6);
    // The window covering the whole plan recognizes the fee once, in full.
    expect(both.inPeriod.revenue).toBeCloseTo(100_000, 6);
    // And "overall" is always the untouched fee, whatever the window.
    expect(august.overall.revenue).toBeCloseTo(100_000, 6);
  });
});

describe("buildFinanceReport — partial totals", () => {
  test("an uncostable role makes the cost total partial, not smaller", () => {
    const costed = role({ roleId: "r_costed" });
    // Assigned but with no employment row: genuinely unknown, never averaged.
    const unknown = role({ roleId: "r_unknown", staffHourlyCost: null });
    const report = build({
      projects: [project({ roles: [costed, unknown] })],
    });

    // Only the costed role's hours are priced: 344h × $100.
    expect(report.inPeriod.cost).toBeCloseTo(AUGUST_HOURS * 100, 6);
    expect(report.inPeriod.unknownCostRoleCount).toBe(1);
    // Both roles still earn revenue, so margin is overstated *and flagged* rather
    // than silently correct-looking.
    expect(report.inPeriod.revenue).toBeCloseTo(
      2 * AUGUST_HOURS * CARD_RATE,
      6,
    );
  });

  test("an open role costs from the discipline average, or not at all", () => {
    const openEngineer = role({
      roleId: "r_eng",
      staffId: null,
      staffHourlyCost: null,
    });
    const openDesigner = role({
      roleId: "r_des",
      roleType: "DESIGNER",
      staffId: null,
      staffHourlyCost: null,
    });
    const report = build({
      projects: [project({ roles: [openEngineer, openDesigner] })],
    });

    // ENGINEER has an average ($90); DESIGNER is absent from the map, so it is
    // UNKNOWN rather than free.
    expect(report.inPeriod.cost).toBeCloseTo(AUGUST_HOURS * 90, 6);
    expect(report.inPeriod.unknownCostRoleCount).toBe(1);
  });

  test("a project with no billing type contributes null revenue and is tallied", () => {
    const priced = project({ id: "p_priced", name: "Priced" });
    const unpriced = project({
      id: "p_unpriced",
      name: "Unpriced",
      billing: { billingType: null, budgetAmount: null, budgetCurrency: null },
    });
    const report = build({ projects: [priced, unpriced] });

    expect(report.projects).toHaveLength(2);
    expect(report.inPeriod.projectsWithoutBillingType).toBe(1);
    // The total is the priced project alone — partial, with the tally to say so —
    // and the unpriced row reports null rather than 0.
    expect(report.inPeriod.revenue).toBeCloseTo(AUGUST_HOURS * CARD_RATE, 6);
    const row = report.projects.find((p) => p.projectId === "p_unpriced");
    expect(row?.inPeriod.totals.revenue).toBeNull();
    // Its hours are still real, so they belong in the hours total.
    expect(report.inPeriod.hours).toBe(2 * AUGUST_HOURS);
  });

  test("no cost basis nulls every cost figure without touching revenue", () => {
    const report = build({ projects: [project()], includeCost: false });

    expect(report.includesCost).toBe(false);
    expect(report.inPeriod.cost).toBeNull();
    expect(report.inPeriod.margin).toBeNull();
    expect(report.inPeriod.marginPercent).toBeNull();
    expect(report.inPeriod.revenue).toBeCloseTo(AUGUST_HOURS * CARD_RATE, 6);
    // Partiality is not the story when nothing is costed at all.
    expect(report.inPeriod.unknownCostRoleCount).toBe(0);
  });
});

describe("buildFinanceReport — rates", () => {
  test("blended rate is revenue over hours, and null with no hours", () => {
    const report = build({ projects: [project()] });
    expect(report.inPeriod.blendedRate).toBeCloseTo(CARD_RATE, 6);

    // An empty portfolio divides nothing by nothing and says so.
    const empty = build({ projects: [] });
    expect(empty.inPeriod.blendedRate).toBeNull();
    expect(empty.inPeriod.revenue).toBeNull();
    expect(empty.inPeriod.marginPercent).toBeNull();
    expect(empty.projects).toHaveLength(0);
  });

  test("a fixed-fee-only discipline has a card rate but no blended rate", () => {
    // The ADR 0066 boundary: a fee is not attributable to the discipline that
    // delivered it, so `blended` must stay null there rather than apportioning.
    const feeProject = project({
      id: "p_fee",
      billing: FIXED_FEE,
      roles: [role({ roleId: "r_fee", roleType: "ENGINEER" })],
    });
    const tmProject = project({
      id: "p_tm",
      roles: [role({ roleId: "r_tm", roleType: "DESIGNER" })],
    });
    const report = build({ projects: [feeProject, tmProject] });

    const engineer = report.rates.find((r) => r.roleType === "ENGINEER");
    expect(engineer?.cardRate).toBeCloseTo(CARD_RATE, 6);
    expect(engineer?.blended).toBeNull();
    expect(engineer?.timeAndMaterialsHours).toBe(0);
    expect(engineer?.hours).toBe(AUGUST_HOURS);

    const designer = report.rates.find((r) => r.roleType === "DESIGNER");
    expect(designer?.blended).toBeCloseTo(CARD_RATE, 6);
    expect(designer?.timeAndMaterialsHours).toBe(AUGUST_HOURS);
  });

  test("discipline hours reconcile with the in-period total", () => {
    const report = build({
      projects: [
        project({
          roles: [
            role({ roleId: "a", roleType: "ENGINEER" }),
            role({ roleId: "b", roleType: "DESIGNER" }),
            role({ roleId: "c", roleType: "QA", hoursPerDay: 4 }),
          ],
        }),
      ],
    });

    const summed = report.rates.reduce((total, r) => total + r.hours, 0);
    expect(summed).toBe(report.inPeriod.hours);
    // Only disciplines with hours appear — no empty rows inviting "—" to be read
    // as a rate of nothing.
    expect(report.rates.map((r) => r.roleType)).toEqual([
      "ENGINEER",
      "DESIGNER",
      "QA",
    ]);
  });

  test("the card rate is hours-weighted, not a plain mean of rates", () => {
    const report = build({
      projects: [
        project({
          roles: [
            // 21 weekdays × 8h at $100, and 21 weekdays × 2h at $300.
            role({
              roleId: "long",
              billRate: 100,
              hoursPerDay: 8,
              ...IN_AUGUST,
            }),
            role({
              roleId: "short",
              billRate: 300,
              hoursPerDay: 2,
              ...IN_AUGUST,
            }),
          ],
        }),
      ],
    });

    const engineer = report.rates.find((r) => r.roleType === "ENGINEER");
    const hours = 21 * 8 + 21 * 2;
    const expected = (21 * 8 * 100 + 21 * 2 * 300) / hours;
    expect(engineer?.cardRate).toBeCloseTo(expected, 6);
    // A plain mean would be $200; the weighted rate is $140.
    expect(engineer?.cardRate).not.toBeCloseTo(200, 1);
  });
});

describe("buildFinanceReport — currency", () => {
  test("amounts scale with the display currency but percentages do not", () => {
    const projects = [project(), project({ id: "p2", billing: FIXED_FEE })];
    const usd = build({ projects, displayCurrency: "USD" });
    const cad = build({ projects, displayCurrency: "CAD" });

    // 1 USD = 2 CAD, so every amount doubles — revenue, cost, margin and rates.
    expect(cad.inPeriod.revenue).toBeCloseTo(
      (usd.inPeriod.revenue ?? 0) * 2,
      6,
    );
    expect(cad.inPeriod.cost).toBeCloseTo((usd.inPeriod.cost ?? 0) * 2, 6);
    expect(cad.inPeriod.margin).toBeCloseTo((usd.inPeriod.margin ?? 0) * 2, 6);
    expect(cad.inPeriod.blendedRate).toBeCloseTo(
      (usd.inPeriod.blendedRate ?? 0) * 2,
      6,
    );

    // The percentage is the same portfolio either way. A margin that changed with
    // the toggle would make the same book profitable in one currency only.
    expect(cad.inPeriod.marginPercent).toBeCloseTo(
      usd.inPeriod.marginPercent ?? 0,
      10,
    );
    expect(cad.overall.marginPercent).toBeCloseTo(
      usd.overall.marginPercent ?? 0,
      10,
    );
    expect(cad.fixedFee.deltaPercent).toBeCloseTo(
      usd.fixedFee.deltaPercent ?? 0,
      10,
    );
    expect(cad.offStandard.share).toBe(usd.offStandard.share);

    // Hours are a quantity, not money — they must not move at all.
    expect(cad.inPeriod.hours).toBe(usd.inPeriod.hours);
  });

  test("a foreign fixed fee is reported as converted", () => {
    const report = build({
      projects: [
        project({
          billing: { ...FIXED_FEE, budgetCurrency: "CAD" },
        }),
      ],
      displayCurrency: "USD",
    });

    // CAD fee into USD at 1 USD = 2 CAD ⇒ half. Both currencies are noted: the
    // fee's CAD, and the rate card's USD used to price the roles.
    expect(report.inPeriod.revenue).toBeCloseTo(
      50_000 * (AUGUST_HOURS / TOTAL_HOURS),
      6,
    );
    expect(report.convertedFrom).toEqual(["CAD"]);
  });
});

describe("buildFinanceReport — line of business", () => {
  test("filtering keeps matching roles and drops projects left with none", () => {
    const mixed = project({
      id: "p_mixed",
      roles: [
        role({ roleId: "r_core", lineOfBusiness: "CORE" }),
        role({ roleId: "r_fin", lineOfBusiness: "FINTECH" }),
      ],
    });
    const coreOnly = project({
      id: "p_core",
      roles: [role({ roleId: "r_c2", lineOfBusiness: "CORE" })],
    });

    const report = build({
      projects: [mixed, coreOnly],
      lineOfBusiness: "FINTECH",
    });

    // The CORE-only project isn't "a FINTECH project with no revenue" — it is not
    // a FINTECH project, so it leaves the table entirely.
    expect(report.projects.map((p) => p.projectId)).toEqual(["p_mixed"]);
    expect(report.inPeriod.hours).toBe(AUGUST_HOURS);
    expect(report.projects[0].linesOfBusiness).toEqual(["FINTECH"]);
  });

  test("a filtered fixed fee is prorated, and the practices sum to the fee", () => {
    const mixed = project({
      billing: FIXED_FEE,
      roles: [
        role({ roleId: "r_core", lineOfBusiness: "CORE" }),
        role({ roleId: "r_fin", lineOfBusiness: "FINTECH" }),
      ],
    });

    const core = build({
      projects: [mixed],
      range: BOTH_MONTHS,
      lineOfBusiness: "CORE",
    });
    const fintech = build({
      projects: [mixed],
      range: BOTH_MONTHS,
      lineOfBusiness: "FINTECH",
    });
    const all = build({ projects: [mixed], range: BOTH_MONTHS });

    // Equal spans ⇒ $50k each, not $100k each. This is the whole reason the share
    // divides by the plan rather than by the slice.
    expect(core.inPeriod.revenue).toBeCloseTo(50_000, 6);
    expect(fintech.inPeriod.revenue).toBeCloseTo(50_000, 6);
    expect(
      (core.inPeriod.revenue ?? 0) + (fintech.inPeriod.revenue ?? 0),
    ).toBeCloseTo(100_000, 6);
    expect(all.inPeriod.revenue).toBeCloseTo(100_000, 6);
    // "Overall" is prorated by practice too, or a practice view would show the
    // whole fee in the column next to its own prorated half.
    expect(core.overall.revenue).toBeCloseTo(50_000, 6);
  });
});

describe("buildFinanceReport — pricing widgets", () => {
  test("the fixed-fee roll-up compares fees against the same roles priced hourly", () => {
    // 344h × $250 = $86,000 at role rates, sold for a $100,000 fee ⇒ a premium.
    const report = build({
      projects: [project({ billing: FIXED_FEE })],
      range: BOTH_MONTHS,
    });

    expect(report.fixedFee.projectCount).toBe(1);
    expect(report.fixedFee.revenue).toBeCloseTo(100_000, 6);
    expect(report.fixedFee.hourlyValue).toBeCloseTo(TOTAL_HOURS * CARD_RATE, 6);
    expect(report.fixedFee.delta).toBeCloseTo(
      100_000 - TOTAL_HOURS * CARD_RATE,
      6,
    );
    expect(report.fixedFee.deltaPercent).toBeCloseTo(
      (100_000 - TOTAL_HOURS * CARD_RATE) / (TOTAL_HOURS * CARD_RATE),
      10,
    );
  });

  test("a portfolio with no fixed fees reports null, not a zero discount", () => {
    const report = build({ projects: [project()] });
    expect(report.fixedFee.projectCount).toBe(0);
    expect(report.fixedFee.delta).toBeNull();
    expect(report.fixedFee.deltaPercent).toBeNull();
  });

  test("off-standard exposure measures hours and amount at role rates", () => {
    const onCard = role({ roleId: "r_on", billRate: CARD_RATE, ...IN_AUGUST });
    const offCard = role({ roleId: "r_off", billRate: 400, ...IN_AUGUST });
    const report = build({
      projects: [project({ roles: [onCard, offCard] })],
    });

    expect(report.offStandard.roleCount).toBe(1);
    expect(report.offStandard.hours).toBe(AUGUST_HOURS);
    expect(report.offStandard.amountAtRoleRates).toBeCloseTo(
      AUGUST_HOURS * 400,
      6,
    );
    expect(report.offStandard.totalAtRoleRates).toBeCloseTo(
      AUGUST_HOURS * (400 + CARD_RATE),
      6,
    );
    expect(report.offStandard.share).toBeCloseTo(400 / (400 + CARD_RATE), 10);
  });

  test("an all-on-card portfolio reports zero exposure, and an empty one null", () => {
    const report = build({ projects: [project()] });
    expect(report.offStandard.roleCount).toBe(0);
    expect(report.offStandard.share).toBe(0);

    // Nothing priced at all ⇒ no denominator, so "—" rather than a reassuring 0%.
    const empty = build({ projects: [] });
    expect(empty.offStandard.share).toBeNull();
  });
});

describe("buildFinanceReport — project rows", () => {
  test("rows are ordered by in-period revenue, unpriced last", () => {
    const small = project({
      id: "p_small",
      name: "Small",
      roles: [role({ roleId: "r_s", hoursPerDay: 2 })],
    });
    const big = project({
      id: "p_big",
      name: "Big",
      roles: [role({ roleId: "r_b", hoursPerDay: 8 })],
    });
    const unpriced = project({
      id: "p_none",
      name: "None",
      billing: { billingType: null, budgetAmount: null, budgetCurrency: null },
    });

    const report = build({ projects: [small, unpriced, big] });
    expect(report.projects.map((p) => p.projectId)).toEqual([
      "p_big",
      "p_small",
      "p_none",
    ]);
  });

  test("a row carries the whole plan's span, not the window's", () => {
    const report = build({ projects: [project()], range: AUGUST });
    const row = report.projects[0];

    // The reader needs to see how much of the engagement sits outside the window.
    expect(row.startDate).toBe(BOTH_MONTHS.start);
    expect(row.endDate).toBe(BOTH_MONTHS.end);
    expect(row.status).toBe("confirmed");
  });

  test("feeShare is null for T&M and the recognized fraction for a fee", () => {
    const tm = build({ projects: [project()] });
    expect(tm.projects[0].feeShare).toBeNull();

    const fee = build({ projects: [project({ billing: FIXED_FEE })] });
    expect(fee.projects[0].feeShare).toBeCloseTo(
      AUGUST_HOURS / TOTAL_HOURS,
      10,
    );
  });

  // The report is a prop of a Client Component, so everything it carries is
  // serialized into the page HTML. A per-role `cost` and `hours` pair reconstructs
  // an individual's hourly compensation, so the whole report is asserted against
  // the SERIALIZED payload rather than against a field list — a field list only
  // proves the fields you thought to name are absent. Reintroducing a spread in
  // `projectBasis` fails this.
  test("no per-role cost is anywhere in the serialized payload", () => {
    const report = build({
      projects: [
        project({ billing: FIXED_FEE }),
        project({
          id: "p2",
          roles: [
            role({
              roleId: "r_a",
              staffHourlyCost: { amount: 137, currency: "USD" },
            }),
            role({ roleId: "r_b", staffId: null, staffHourlyCost: null }),
          ],
        }),
      ],
    });

    const wire = JSON.stringify(report);
    expect(wire).not.toContain("perRole");
    expect(wire).not.toContain("byRoleId");
    expect(wire).not.toContain("costBasis");
    expect(wire).not.toContain("staffHourlyCost");
    expect(wire).not.toContain("staffId");
    // The distinctive hourly figure itself must not appear — 137/h would otherwise
    // be recoverable from a role's cost ÷ its hours.
    expect(wire).not.toContain("137");

    // And the aggregate cost that SHOULD be there still is, so this test can't pass
    // by the report having quietly become empty.
    expect(report.inPeriod.cost).not.toBeNull();
  });

  test("a cancelled-only project is absent, not a zero row", () => {
    const dead = project({
      id: "p_dead",
      roles: [role({ roleId: "r_d", status: "cancelled" })],
    });
    const report = build({ projects: [dead, project()] });

    expect(report.projects.map((p) => p.projectId)).toEqual(["proj_1"]);
    expect(report.inPeriod.projectCount).toBe(1);
  });
});
