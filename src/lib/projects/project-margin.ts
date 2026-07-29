/**
 * Revenue, cost and margin for a project plan. A pure, client-importable module
 * (no `db`, no React) so the server read and the client's currency toggle share
 * one implementation — the reader ships native amounts plus a USD rate table and
 * this recomputes on every toggle, per ADR 0029.
 *
 * ── What the two billing models can honestly say ────────────────────────────
 * A TIME_AND_MATERIALS project bills each role type by the hour at the company's
 * standard rate card (`@/lib/projects/bill-rates`), so revenue is attributable per
 * role and every row gets a real margin. A FIXED_FEE project has ONE price for the
 * whole engagement: apportioning it across roles would invent a number, so per-role
 * revenue is `null` and the margin percentage exists only at the project level, where
 * it is true. Per-role rows still carry hours and cost.
 *
 * ── Conversion provenance ───────────────────────────────────────────────────
 * Every amount below is already in the display currency;
 * {@link ProjectMargin.convertedFrom} records which currencies a rate was actually
 * applied to along the way. That is deliberately a per-*panel* fact rather than a
 * per-value one: the UI states the conversion once beside the currency selector,
 * naming the rates used, instead of marking each figure.
 */
import {
  CURRENCY,
  type Currency,
  DISPLAY_CURRENCIES,
  type DisplayCurrency,
} from "@/lib/format/currency";
import { convert } from "@/lib/format/fx";
import { BILL_RATE_CURRENCY, BILL_RATES } from "@/lib/projects/bill-rates";
import type { BillingType } from "@/lib/projects/project-billing";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import type { ProjectRoleType } from "@/lib/projects/project-role-type";
import { countWorkingDays } from "@/lib/staff/pto-working-days";

/** An amount in the currency it is actually denominated in. */
export type NativeMoney = { amount: number; currency: Currency };

/** A project's billing model. `billingType: null` ⇒ no budget set. */
export type MarginBilling = {
  billingType: BillingType | null;
  budgetAmount: number | null;
  budgetCurrency: Currency | null;
};

/** Where a role's cost figure came from — never let an estimate read as a fact. */
export type RoleCostBasis =
  /** The assigned person's own compensation. */
  | "PERSON"
  /** The company-wide average for the role type (an open role). */
  | "ROLE_AVERAGE"
  /** No basis at all: nobody assigned and no average, or an assignee with no employment row. */
  | "UNKNOWN"
  /** Cost is withheld because the viewer lacks `projects.viewMargin`. */
  | "HIDDEN";

export type MarginRoleInput = {
  roleId: string;
  roleType: ProjectRoleType;
  status: ProjectRoleStatus;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
  /** Null for an open (unstaffed) role — the distinction the cost basis turns on. */
  staffId: string | null;
  /** The assignee's native hourly cost; null when open, or when they have no employment row. */
  staffHourlyCost: NativeMoney | null;
};

export type RoleMargin = {
  roleId: string;
  /** False for a `cancelled` role: zero hours and every money figure null. */
  counted: boolean;
  hours: number;
  /** Null for FIXED_FEE — a single fee isn't attributable to one role. */
  revenue: number | null;
  cost: number | null;
  costBasis: RoleCostBasis;
  margin: number | null;
  marginPercent: number | null;
};

export type BudgetTotals = {
  hours: number;
  revenue: number | null;
  cost: number | null;
  margin: number | null;
  marginPercent: number | null;
};

export type ProjectMargin = {
  displayCurrency: Currency;
  billingType: BillingType | null;
  /** False when the viewer lacks `projects.viewMargin` — every cost/margin field is null. */
  includesCost: boolean;
  perRole: RoleMargin[];
  byRoleId: Map<string, RoleMargin>;
  totals: BudgetTotals;
  /** Roles counted toward the budget (i.e. not cancelled). */
  countedRoleCount: number;
  /** Counted roles with nobody assigned — costed from the role-type average. */
  openRoleCount: number;
  /** Counted roles with no cost basis at all: the cost total is partial. */
  unknownCostRoleCount: number;
  /**
   * The distinct currencies an exchange rate was actually applied to, in canonical
   * `CURRENCY` order. Empty when every figure was already in the display currency.
   *
   * The UI states the conversion once — with the rates used — beside the currency
   * selector, rather than flagging each converted value: the caveat belongs to the
   * whole panel, and per-figure icons said "converted" without ever saying at what.
   */
  convertedFrom: Currency[];
};

/**
 * Billable hours for a role: the actual Mon–Fri weekdays in its inclusive span ×
 * `hoursPerDay`.
 *
 * Deliberately NOT derived from the planner grids' bucket percentages. Per ADR
 * 0040 a month column shows the role's flat nominal *rate* and is not prorated by
 * the working days it covers — so a grid percentage is a rate, never a quantity,
 * and money computed from one would be wrong by whole weeks. Statutory holidays
 * are not modelled (there is no holiday calendar), so hours are a slight
 * overstatement — symmetrically on both the revenue and the cost side.
 */
export function roleBillableHours(role: {
  startDate: string;
  endDate: string;
  hoursPerDay: number;
}): number {
  return countWorkingDays(role.startDate, role.endDate) * role.hoursPerDay;
}

/**
 * Does this role's plan count toward the project's money? Everything except
 * `cancelled`: cancelled work will never be delivered or billed, while `paused`
 * is expected to resume on the dates it still carries.
 *
 * Deliberately NOT the allocations grid's `["tentative","confirmed"]` filter —
 * that answers a different question (whose capacity is committed right now).
 *
 * PTO is likewise ignored: leave shifts constantly and is partly still pending,
 * and a salaried person's cost accrues while they're away — so netting leave off
 * hours would move revenue without moving cost and swing margin for a
 * non-commercial reason. Leave is surfaced on the project's own PTO tab instead.
 */
export function countsTowardBudget(status: ProjectRoleStatus): boolean {
  return status !== "cancelled";
}

/**
 * The currency a project's money reads in by default: a fixed fee's own denomination
 * when that's one we display in, else the standard rate card's currency if displayable,
 * else USD.
 *
 * Why not just default to CAD like the compensation dashboards: a T&M project bills in
 * the rate card's currency, so a blanket CAD default would open every one of them with
 * a conversion note on figures that needed no rate at all.
 */
export function resolveDisplayCurrency({
  budgetCurrency,
}: {
  budgetCurrency: Currency | null;
}): DisplayCurrency {
  if (isDisplayCurrency(budgetCurrency)) return budgetCurrency;
  if (isDisplayCurrency(BILL_RATE_CURRENCY)) return BILL_RATE_CURRENCY;
  return "USD";
}

function isDisplayCurrency(
  currency: Currency | null,
): currency is DisplayCurrency {
  return (
    currency != null &&
    (DISPLAY_CURRENCIES as readonly Currency[]).includes(currency)
  );
}

/**
 * Tailwind tone for a margin percentage. Only losses get colour — the same
 * convention as the compensation editor's change columns.
 *
 * Reimplemented here rather than importing `changeTone` from the performance
 * components: a lib module must not depend on a component directory, and
 * `changeTone`'s "zero is neutral" reads as *no change*, which is not what a 0%
 * margin means. The percentage is rounded to display precision FIRST, so a
 * figure that renders as "0.0%" can never come out red.
 */
export function marginTone(marginPercent: number | null): string {
  if (marginPercent == null) return "";
  const displayed = Number((marginPercent * 100).toFixed(1));
  return displayed < 0 ? "text-destructive" : "";
}

/**
 * The same rule for a margin *amount* — the headline figure in the summary panel,
 * where the money is primary and the percentage is the supporting line.
 *
 * Rounds to whole dollars first, because that's how `aggregateMoneyFormatters`
 * renders an aggregate: a −$0.30 margin displays as "CA$0", and colouring a figure
 * that reads as zero would be a lie about what's on screen.
 */
export function marginAmountTone(margin: number | null): string {
  if (margin == null) return "";
  return Math.round(margin) < 0 ? "text-destructive" : "";
}

/**
 * Revenue, cost and margin for a whole plan, per role and in total.
 *
 * `includeCost: false` is the shape a viewer without `projects.viewMargin` gets —
 * but note the *server* is what withholds the inputs (see `getProjectCostBasis`);
 * this flag only keeps the compute honest when they're absent.
 */
export function computeProjectMargin({
  billing,
  roles,
  openRoleCostUsd,
  displayCurrency,
  usdRates,
  includeCost,
}: {
  billing: MarginBilling;
  roles: readonly MarginRoleInput[];
  /** Company-wide average hourly cost per role type, in USD. Absent ⇒ no basis. */
  openRoleCostUsd: Partial<Record<ProjectRoleType, number>>;
  displayCurrency: Currency;
  usdRates: Record<Currency, number>;
  includeCost: boolean;
}): ProjectMargin {
  const isTimeAndMaterials = billing.billingType === "TIME_AND_MATERIALS";

  // Every currency an exchange rate was actually applied to, so the panel can name
  // the rates it used. Recorded at each conversion site rather than inferred from the
  // inputs: a rate-card row already in the display currency needed no rate, and
  // claiming otherwise would overstate the caveat.
  const convertedFrom = new Set<Currency>();
  const noteConversion = (from: Currency) => {
    if (from !== displayCurrency) convertedFrom.add(from);
  };

  const perRole: RoleMargin[] = roles.map((role) => {
    const counted = countsTowardBudget(role.status);
    if (!counted) {
      return {
        roleId: role.roleId,
        counted: false,
        hours: 0,
        revenue: null,
        cost: null,
        costBasis: includeCost ? "UNKNOWN" : "HIDDEN",
        margin: null,
        marginPercent: null,
      };
    }

    const hours = roleBillableHours(role);
    // The standard rate card covers every role type, so a T&M role always prices.
    let revenue: number | null = null;
    if (isTimeAndMaterials) {
      noteConversion(BILL_RATE_CURRENCY);
      revenue = convert(
        hours * BILL_RATES[role.roleType],
        BILL_RATE_CURRENCY,
        displayCurrency,
        usdRates,
      );
    }

    const { cost, costBasis } = roleCost({
      role,
      hours,
      openRoleCostUsd,
      displayCurrency,
      usdRates,
      includeCost,
      noteConversion,
    });

    return {
      roleId: role.roleId,
      counted: true,
      hours,
      revenue,
      cost,
      costBasis,
      ...marginOf(revenue, cost),
    };
  });

  const counted = perRole.filter((row) => row.counted);

  // A FIXED_FEE project's revenue is the fee itself, converted once. A T&M
  // project's is the sum of its priced roles — roles whose role type has no rate
  // row contribute nothing and are counted separately, so the UI can say the total
  // is partial rather than presenting it as complete.
  const revenueTotal = ((): number | null => {
    if (billing.billingType === "FIXED_FEE") {
      if (billing.budgetAmount == null || billing.budgetCurrency == null) {
        return null;
      }
      noteConversion(billing.budgetCurrency);
      return convert(
        billing.budgetAmount,
        billing.budgetCurrency,
        displayCurrency,
        usdRates,
      );
    }
    if (!isTimeAndMaterials) return null;
    return sumKnown(counted.map((row) => row.revenue));
  })();

  // Roles with no cost basis contribute nothing rather than a zero, so the total is
  // *partial* rather than quietly deflated — `unknownCostRoleCount` says how partial.
  const costTotal = includeCost
    ? sumKnown(counted.map((row) => row.cost))
    : null;

  return {
    displayCurrency,
    billingType: billing.billingType,
    includesCost: includeCost,
    perRole,
    byRoleId: new Map(perRole.map((row) => [row.roleId, row])),
    totals: {
      hours: counted.reduce((total, row) => total + row.hours, 0),
      revenue: revenueTotal,
      cost: costTotal,
      ...marginOf(revenueTotal, costTotal),
    },
    countedRoleCount: counted.length,
    openRoleCount: roles.filter(
      (role) => countsTowardBudget(role.status) && role.staffId == null,
    ).length,
    unknownCostRoleCount: includeCost
      ? counted.filter((row) => row.costBasis === "UNKNOWN").length
      : 0,
    // Canonical order, so the rate list reads the same way every render.
    convertedFrom: CURRENCY.filter((code) => convertedFrom.has(code)),
  };
}

/**
 * A role's cost for its whole span: the assignee's own hourly compensation when
 * one is assigned, otherwise the company-wide average for the discipline. A role
 * type with no staff to average is ABSENT from `openRoleCostUsd` rather than zero
 * — "no basis" and "free" are different claims — so it lands on UNKNOWN and is
 * excluded from the total instead of quietly deflating it.
 */
function roleCost({
  role,
  hours,
  openRoleCostUsd,
  displayCurrency,
  usdRates,
  includeCost,
  noteConversion,
}: {
  role: MarginRoleInput;
  hours: number;
  openRoleCostUsd: Partial<Record<ProjectRoleType, number>>;
  displayCurrency: Currency;
  usdRates: Record<Currency, number>;
  includeCost: boolean;
  noteConversion: (from: Currency) => void;
}): { cost: number | null; costBasis: RoleCostBasis } {
  if (!includeCost) return { cost: null, costBasis: "HIDDEN" };

  if (role.staffHourlyCost) {
    noteConversion(role.staffHourlyCost.currency);
    const hourly = convert(
      role.staffHourlyCost.amount,
      role.staffHourlyCost.currency,
      displayCurrency,
      usdRates,
    );
    return { cost: hourly * hours, costBasis: "PERSON" };
  }

  // Only an OPEN role falls back to the average. Someone assigned but with no
  // employment row is genuinely unknown — averaging them would put a stranger's
  // number under a named person.
  const average =
    role.staffId == null ? openRoleCostUsd[role.roleType] : undefined;
  if (average == null) return { cost: null, costBasis: "UNKNOWN" };

  // The role-type averages are carried in USD (see `getRoleTypeAverageCostsUsd`).
  noteConversion("USD");
  const hourly = convert(average, "USD", displayCurrency, usdRates);
  return { cost: hourly * hours, costBasis: "ROLE_AVERAGE" };
}

/** Sum the amounts that are known, ignoring the nulls. */
function sumKnown(amounts: readonly (number | null)[]): number {
  return amounts.reduce<number>((total, amount) => total + (amount ?? 0), 0);
}

/**
 * Margin and margin percentage, defined only when both sides are known. The
 * percentage is null whenever revenue is zero — which guards the divide and, just
 * as importantly, stops a plan with no roles from reporting a triumphant 100%.
 */
function marginOf(
  revenue: number | null,
  cost: number | null,
): { margin: number | null; marginPercent: number | null } {
  if (revenue == null || cost == null) {
    return { margin: null, marginPercent: null };
  }
  const margin = revenue - cost;
  return { margin, marginPercent: revenue > 0 ? margin / revenue : null };
}
