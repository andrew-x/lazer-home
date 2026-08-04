import { describe, expect, test } from "bun:test";
import { LINE_OF_BUSINESS } from "@/lib/crm/line-of-business";
import type { Currency } from "@/lib/format/currency";
import {
  BILL_RATE_EXCEPTIONS,
  billRateFor,
  DEFAULT_BILL_RATE,
  isOffStandardRate,
  rateCardSummary,
} from "./bill-rates";
import {
  computeProjectMargin,
  type MarginRoleInput,
  marginAmountTone,
  marginTone,
  resolveDisplayCurrency,
  roleBillableHours,
} from "./project-margin";
import { PROJECT_ROLE_TYPES } from "./project-role-type";

/**
 * The money math behind a project's budget summary. What's pinned here is the set
 * of claims the UI makes on top of it: that hours come from real weekdays (never
 * the planner's bucket percentages, ADR 0040), that revenue comes from each role's own
 * stored rate rather than a live rate-card lookup (ADR 0066), that an uncostable role
 * makes a total *partial* rather than silently smaller, that a fixed fee is never
 * apportioned across roles but *is* comparable to what those roles would bill hourly,
 * and that "no basis" never renders as zero.
 */

/** 1 USD → currency. Round numbers so expected figures stay checkable by hand. */
const RATES: Record<Currency, number> = {
  USD: 1,
  CAD: 2,
  GBP: 0.5,
  EUR: 1,
  AED: 4,
};

/** Mon 2026-08-03 → Fri 2026-08-14: exactly 10 weekdays. */
const START = "2026-08-03";
const END = "2026-08-14";

function role(overrides: Partial<MarginRoleInput> = {}): MarginRoleInput {
  return {
    roleId: "role-1",
    roleType: "ENGINEER",
    status: "tentative",
    startDate: START,
    endDate: END,
    hoursPerDay: 8,
    billRate: RATE,
    staffId: null,
    staffHourlyCost: null,
    ...overrides,
  };
}

const TM_BILLING = {
  billingType: "TIME_AND_MATERIALS" as const,
  budgetAmount: null,
  budgetCurrency: null,
};

/**
 * The rate a role snapshots by default. Read through `billRateFor` rather than hardcoded
 * so these expectations survive the card gaining exception cells.
 */
const RATE = billRateFor({ lineOfBusiness: "CORE", roleType: "ENGINEER" });

function compute(
  args: Partial<Parameters<typeof computeProjectMargin>[0]> = {},
) {
  return computeProjectMargin({
    billing: TM_BILLING,
    roles: [role()],
    openRoleCostUsd: {},
    displayCurrency: "USD",
    usdRates: RATES,
    includeCost: true,
    ...args,
  });
}

describe("roleBillableHours", () => {
  test("counts weekdays in the inclusive span, not calendar days", () => {
    // 12 calendar days, 10 of them weekdays.
    expect(
      roleBillableHours({ startDate: START, endDate: END, hoursPerDay: 8 }),
    ).toBe(80);
  });

  test("scales by hoursPerDay, including half-days", () => {
    expect(
      roleBillableHours({ startDate: START, endDate: END, hoursPerDay: 4 }),
    ).toBe(40);
  });
});

describe("time & materials", () => {
  test("revenue is hours × the standard rate for the role's type", () => {
    const result = compute();
    expect(result.totals.hours).toBe(80);
    expect(result.totals.revenue).toBe(80 * RATE);
    // The rate card is already in the display currency, so no rate was applied.
    expect(result.convertedFrom).toEqual([]);
  });

  test("every role type prices — the standard card covers all of them", () => {
    const result = compute({
      roles: [role(), role({ roleId: "role-2", roleType: "SPECIALIST" })],
    });

    expect(result.perRole.every((row) => row.revenue === 80 * RATE)).toBe(true);
    expect(result.totals.revenue).toBe(160 * RATE);
  });

  test("an open role is costed from the role-type average, and says so", () => {
    const result = compute({ openRoleCostUsd: { ENGINEER: 100 } });
    const [row] = result.perRole;

    expect(row.costBasis).toBe("ROLE_AVERAGE");
    expect(row.cost).toBe(8_000);
    expect(row.margin).toBe(80 * RATE - 8_000);
    expect(result.openRoleCount).toBe(1);
  });

  test("an assigned person's own compensation wins over the average", () => {
    const result = compute({
      roles: [
        role({
          staffId: "staff-1",
          staffHourlyCost: { amount: 50, currency: "USD" },
        }),
      ],
      openRoleCostUsd: { ENGINEER: 100 },
    });

    expect(result.perRole[0].costBasis).toBe("PERSON");
    expect(result.totals.cost).toBe(4_000);
    expect(result.openRoleCount).toBe(0);
  });

  test("an assignee with no employment row is UNKNOWN, never the average", () => {
    const result = compute({
      roles: [role({ staffId: "staff-1", staffHourlyCost: null })],
      openRoleCostUsd: { ENGINEER: 100 },
    });

    expect(result.perRole[0].costBasis).toBe("UNKNOWN");
    expect(result.perRole[0].cost).toBeNull();
    expect(result.unknownCostRoleCount).toBe(1);
    // The cost total excludes it rather than deflating with a zero.
    expect(result.totals.cost).toBe(0);
  });

  test("a cancelled role contributes no hours and no money", () => {
    const result = compute({
      roles: [role(), role({ roleId: "role-2", status: "cancelled" })],
    });

    expect(result.perRole[1].counted).toBe(false);
    expect(result.perRole[1].hours).toBe(0);
    expect(result.countedRoleCount).toBe(1);
    expect(result.totals.hours).toBe(80);
  });

  test("paused roles still count — only cancelled work is dropped", () => {
    const result = compute({ roles: [role({ status: "paused" })] });
    expect(result.totals.hours).toBe(80);
  });

  test("zero roles yields no margin percentage rather than 100%", () => {
    const result = compute({ roles: [] });

    expect(result.totals.revenue).toBe(0);
    expect(result.totals.cost).toBe(0);
    expect(result.totals.marginPercent).toBeNull();
  });
});

describe("fixed fee", () => {
  const FIXED = {
    billing: {
      billingType: "FIXED_FEE" as const,
      budgetAmount: 20_000,
      budgetCurrency: "USD" as const,
    },
  };

  test("revenue is the fee, and is never apportioned across roles", () => {
    const result = compute({
      ...FIXED,
      roles: [role(), role({ roleId: "role-2" })],
      openRoleCostUsd: { ENGINEER: 50 },
    });

    expect(result.totals.revenue).toBe(20_000);
    expect(result.perRole.every((row) => row.revenue == null)).toBe(true);
    // Rows still carry hours and cost — just no percentage of their own.
    expect(result.perRole[0].cost).toBe(4_000);
    expect(result.perRole[0].marginPercent).toBeNull();
    expect(result.totals.marginPercent).toBeCloseTo(0.6);
  });

  // A fixed fee now DOES apply the roles' rates — to build the hourly comparator — so
  // it legitimately claims a USD conversion where it didn't before ADR 0066. The USD
  // case must stay empty: a figure already in the display currency needed no rate.
  test("a fixed fee in its own currency converts nothing", () => {
    expect(compute(FIXED).convertedFrom).toEqual([]);
  });

  test("a fixed fee displayed in another currency converts the roles' rates", () => {
    expect(
      compute({ ...FIXED, displayCurrency: "CAD" }).convertedFrom,
    ).toContain("USD");
  });

  test("the fee reads as a discount against what the roles would bill hourly", () => {
    // One 80h role at 250/hr = 20,000 hourly value, against a 16,000 fee.
    const result = compute({
      billing: { ...FIXED.billing, budgetAmount: 16_000 },
    });

    expect(result.totals.hourlyValue).toBe(20_000);
    expect(result.totals.hourlyValueDelta).toBe(-4_000);
    expect(result.totals.hourlyValueDeltaPercent).toBeCloseTo(-0.2);
  });

  test("a fee above the roles' hourly value reads as a premium", () => {
    const result = compute({
      billing: { ...FIXED.billing, budgetAmount: 25_000 },
    });

    expect(result.totals.hourlyValueDelta).toBe(5_000);
    expect(result.totals.hourlyValueDeltaPercent).toBeCloseTo(0.25);
  });

  test("a role still carries its rate even though it carries no revenue", () => {
    // The line ADR 0053 §5 draws: an amount could be summed into an apportionment of
    // the fee, a rate cannot — so the rate stays readable on a fixed-fee row.
    const result = compute(FIXED);

    expect(result.perRole[0].revenue).toBeNull();
    expect(result.perRole[0].billRate).toBe(RATE);
  });

  test("a cancelled role contributes nothing to the hourly comparator", () => {
    const result = compute({
      ...FIXED,
      roles: [role(), role({ roleId: "role-2", status: "cancelled" })],
    });

    expect(result.totals.hourlyValue).toBe(20_000);
    expect(result.perRole[1].billRate).toBeNull();
  });

  test("a fee with no roles has no comparator percentage to report", () => {
    const result = compute({ ...FIXED, roles: [] });

    expect(result.totals.hourlyValue).toBe(0);
    expect(result.totals.hourlyValueDeltaPercent).toBeNull();
  });
});

describe("the hourly comparator is fixed-fee only", () => {
  test("time & materials reports none of it, because it would just be revenue", () => {
    const result = compute();

    expect(result.totals.revenue).toBe(80 * RATE);
    expect(result.totals.hourlyValue).toBeNull();
    expect(result.totals.hourlyValueDelta).toBeNull();
    expect(result.totals.hourlyValueDeltaPercent).toBeNull();
  });

  test("a project with no billing model has nothing to compare against", () => {
    const result = compute({
      billing: { billingType: null, budgetAmount: null, budgetCurrency: null },
    });

    expect(result.totals.hourlyValue).toBeNull();
    expect(result.perRole[0].billRate).toBeNull();
  });
});

describe("rates come from the row, not the card", () => {
  test("a role priced off the card bills at its own stored rate", () => {
    const result = compute({ roles: [role({ billRate: 300 })] });

    expect(result.totals.revenue).toBe(80 * 300);
    // Already in the display currency, so no rate was applied to it.
    expect(result.convertedFrom).toEqual([]);
  });

  test("a stored rate converts exactly like a card rate would", () => {
    const result = compute({
      roles: [role({ billRate: 300 })],
      displayCurrency: "CAD",
    });

    expect(result.totals.revenue).toBe(80 * 300 * 2);
    expect(result.perRole[0].billRate).toBe(600);
  });

  test("roles at different rates sum without either winning", () => {
    // Proves the math reads each row rather than resolving one rate for the plan.
    const result = compute({
      roles: [
        role({ billRate: 200 }),
        role({ roleId: "role-2", billRate: 400 }),
      ],
    });

    expect(result.totals.revenue).toBe(80 * 200 + 80 * 400);
  });
});

describe("billRateFor", () => {
  // The card is `Partial` in both dimensions now, so the type checker no longer forces
  // a new line of business or discipline to be priced. This loop is what's left of that
  // pressure: every pair must resolve to a real, positive rate.
  test("every line of business × discipline resolves to a real rate", () => {
    for (const lineOfBusiness of LINE_OF_BUSINESS) {
      for (const roleType of PROJECT_ROLE_TYPES) {
        const rate = billRateFor({ lineOfBusiness, roleType });
        const expected =
          BILL_RATE_EXCEPTIONS[lineOfBusiness]?.[roleType] ?? DEFAULT_BILL_RATE;

        expect(rate).toBe(expected);
        expect(rate).toBeGreaterThan(0);
      }
    }
  });

  test("only deviating cells are summarised, in canonical order", () => {
    const { defaultRate, exceptions } = rateCardSummary();

    expect(defaultRate).toBe(DEFAULT_BILL_RATE);
    for (const row of exceptions) {
      expect(row.hourlyRate).not.toBe(DEFAULT_BILL_RATE);
    }
    // Canonical order, so the panel reads the same way every render regardless of how
    // the exceptions map happened to be written.
    const order = exceptions.map(
      (row) =>
        LINE_OF_BUSINESS.indexOf(row.lineOfBusiness) *
          PROJECT_ROLE_TYPES.length +
        PROJECT_ROLE_TYPES.indexOf(row.roleType),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("off-standard-rate compares rounded cents, not floats", () => {
    const role = { lineOfBusiness: "CORE" as const, roleType: "QA" as const };
    const card = billRateFor(role);

    expect(isOffStandardRate({ ...role, billRate: card })).toBe(false);
    // A `numeric(12, 2)` round trip can only shift a value by sub-cent amounts, and
    // that must never read as a negotiated rate.
    expect(isOffStandardRate({ ...role, billRate: card + 0.001 })).toBe(false);
    expect(isOffStandardRate({ ...role, billRate: card + 25 })).toBe(true);
  });
});

describe("no budget set", () => {
  test("every revenue figure is null, cost still resolves", () => {
    const result = compute({
      billing: { billingType: null, budgetAmount: null, budgetCurrency: null },
      openRoleCostUsd: { ENGINEER: 100 },
    });

    expect(result.totals.revenue).toBeNull();
    expect(result.totals.marginPercent).toBeNull();
    expect(result.totals.cost).toBe(8_000);
  });
});

describe("currency conversion", () => {
  test("records every currency a rate was applied to, once", () => {
    const result = compute({
      roles: [
        role({
          staffId: "staff-1",
          staffHourlyCost: { amount: 100, currency: "CAD" },
        }),
        role({
          roleId: "role-2",
          staffId: "staff-2",
          staffHourlyCost: { amount: 60, currency: "CAD" },
        }),
      ],
    });

    // CAD 100/hr → USD 50/hr at 1 USD = 2 CAD.
    expect(result.perRole[0].cost).toBe(4_000);
    // Both costs were CAD; the USD rate card needed no rate. Deduped, so the panel
    // names each rate once however many values it touched.
    expect(result.convertedFrom).toEqual(["CAD"]);
  });

  test("displaying CAD converts both the USD rate card and the USD averages", () => {
    const result = compute({
      displayCurrency: "CAD",
      openRoleCostUsd: { ENGINEER: 100 },
    });

    expect(result.convertedFrom).toEqual(["USD"]);
    // 100 USD/hr → 200 CAD/hr × 80 hrs.
    expect(result.totals.cost).toBe(16_000);
    expect(result.totals.revenue).toBe(80 * RATE * 2);
  });

  test("cost withheld from a viewer without the capability leaves no trace", () => {
    const result = compute({
      openRoleCostUsd: { ENGINEER: 100 },
      includeCost: false,
    });

    expect(result.includesCost).toBe(false);
    expect(result.perRole[0].costBasis).toBe("HIDDEN");
    expect(result.perRole[0].cost).toBeNull();
    expect(result.totals.cost).toBeNull();
    expect(result.totals.marginPercent).toBeNull();
    // Revenue is unaffected — it isn't compensation-derived.
    expect(result.totals.revenue).toBe(80 * RATE);
  });
});

describe("resolveDisplayCurrency", () => {
  test("prefers the fixed fee's own denomination", () => {
    expect(resolveDisplayCurrency({ budgetCurrency: "CAD" })).toBe("CAD");
  });

  test("falls back to the rate card's currency when there's no fee", () => {
    expect(resolveDisplayCurrency({ budgetCurrency: null })).toBe("USD");
  });

  test("a fee in a currency we don't display in lands on USD", () => {
    expect(resolveDisplayCurrency({ budgetCurrency: "GBP" })).toBe("USD");
  });
});

describe("presentation helpers", () => {
  test("only losses get colour, and a rounded-to-zero loss does not", () => {
    expect(marginTone(0.35)).toBe("");
    expect(marginTone(0)).toBe("");
    expect(marginTone(null)).toBe("");
    expect(marginTone(-0.2)).toBe("text-destructive");
    // -0.0004 renders as "-0.0%", so it must not read as a loss.
    expect(marginTone(-0.0004)).toBe("");
  });

  test("the amount tone rounds to whole dollars, like the figure it colours", () => {
    expect(marginAmountTone(143_600)).toBe("");
    expect(marginAmountTone(0)).toBe("");
    expect(marginAmountTone(null)).toBe("");
    expect(marginAmountTone(-12_400)).toBe("text-destructive");
    // -0.3 renders as "CA$0", so colouring it would misdescribe the screen.
    expect(marginAmountTone(-0.3)).toBe("");
  });
});
