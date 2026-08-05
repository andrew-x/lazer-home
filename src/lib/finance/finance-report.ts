/**
 * Portfolio revenue, margin and blended rates — the math behind
 * `/reporting/finance`. A pure, client-importable module (no `db`, no React) so
 * the read and its tests share one implementation.
 *
 * ── Plan-based, never invoiced ───────────────────────────────────────────────
 * Every figure here comes from the `project_roles` plan: a rate × the weekdays in
 * a role's span × its hours per day. Nothing in this app prices *logged* time —
 * `time_entries.projectId` points at a project, never at a role, so an hour is
 * never attached to the rate it would bill at. There is therefore no actuals
 * series to reconcile against and no "logged" basis to toggle to, and the page
 * must say "plan" out loud: read as invoiced revenue these numbers are wrong.
 *
 * ── One margin engine, called twice ─────────────────────────────────────────
 * This module does NOT reimplement revenue or cost. It clips each role's dates to
 * the reporting window, scales a fixed fee to the share of hours falling inside
 * it, and calls {@link computeProjectMargin} — the same function the project
 * detail page and the projects list use. Two consequences worth keeping:
 *
 *   1. A project's *overall* figures here are identical to its own budget panel's,
 *      by construction rather than by agreement. That is the point; a finance
 *      report that disagreed with the project it aggregates would be worse than
 *      no report.
 *   2. In-window hours, T&M revenue and cost all fall out of the clip for free,
 *      with revenue and cost clipped *identically* — so the margin percentage
 *      stays coherent instead of dividing a whole-span cost by a partial revenue.
 *
 * ── What a fixed fee may say about a period (refines ADR 0066) ──────────────
 * `computeProjectMargin` refuses to attribute a fee to a *role*, and this module
 * does not relax that: a fee is attributed to **time**, prorated by the share of
 * the project's billable hours that lands in the window (see
 * {@link feeRecognitionShare}). The defining property is that contiguous windows
 * partition the fee exactly — twelve months of a one-year engagement sum back to
 * the whole fee, no more and no less — which is what makes it a recognition
 * schedule rather than an apportionment. It follows the delivery shape, so a
 * front-loaded project recognizes more early.
 *
 * The per-role prohibition still binds, and it is visible in
 * {@link DisciplineRate}: a discipline's blended rate is computable only from T&M
 * work, because splitting a fee across the disciplines that delivered it is
 * exactly the invented number ADR 0066 forbids. The card-rate column is defined
 * everywhere instead — a *rate* can't be mistaken for a share of a fee the way an
 * amount can.
 *
 * ── Filtering by line of business ───────────────────────────────────────────
 * Line of business lives on the role, not the project, so filtering keeps only
 * matching *roles* and recomputes; a project left with none drops out entirely.
 * A fixed fee is prorated by the filtered roles' share of the **whole** plan's
 * hours — the same mechanism the date window uses, and the reason
 * {@link feeRecognitionShare} always divides by the whole plan rather than by the
 * slice. So the five per-practice views of a multi-practice engagement sum to its
 * fee exactly once, instead of each claiming all of it.
 *
 * Both time bases are sliced this way, not just the in-period one: a practice view
 * whose "overall" column showed the entire fee next to its own prorated half would
 * invite exactly the wrong subtraction.
 */

import type { PermissionCheck } from "@/lib/auth/permissions";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import {
  CURRENCY,
  type Currency,
  type DisplayCurrency,
} from "@/lib/format/currency";
import { convert } from "@/lib/format/fx";
import {
  BILL_RATE_CURRENCY,
  isOffStandardRate,
} from "@/lib/projects/bill-rates";
import type { BillingType } from "@/lib/projects/project-billing";
import {
  deriveProjectLinesOfBusiness,
  deriveProjectStatus,
} from "@/lib/projects/project-derived";
import {
  type BudgetTotals,
  computeProjectMargin,
  countsTowardBudget,
  type MarginBilling,
  type MarginRoleInput,
  type ProjectMargin,
  roleBillableHours,
} from "@/lib/projects/project-margin";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import {
  PROJECT_ROLE_TYPES,
  type ProjectRoleType,
} from "@/lib/projects/project-role-type";
import type { ReportRange } from "@/lib/reporting/report-range";

/**
 * Who may read the finance report.
 *
 * `projects.viewMargin` and nothing more — no new capability, so the permission
 * matrix is untouched. The roles that hold it (`finance`, `delivery-manager`,
 * `manager`, `admin`) already read a project's cost and margin on its own detail
 * page; this report re-aggregates that same compensation-derived disclosure
 * across the portfolio rather than exposing a new kind of fact.
 *
 * Revenue is *not* compensation-derived and would not need this gate on its own.
 * It is gated anyway because the page's whole point is revenue **and** margin
 * side by side: a revenue-only variant would be a different report, and splitting
 * the surface in two to avoid one capability check would double the number of
 * places the portfolio total is computed.
 *
 * Declared here, beside the math, so the route, the nav item and the read all
 * resolve one constant and cannot drift apart — the pattern
 * `PROFILE_COMPLETENESS_ACCESS` and `BONUS_PAYMENT_READ_ACCESS` established.
 */
export const FINANCE_REPORT_ACCESS: PermissionCheck = {
  projects: ["viewMargin"],
};

/**
 * The widest finance window, in days (~3 years). Wider than the utilization
 * report's {@link MAX_RANGE_DAYS} because the reads differ in kind: this one is a
 * bounded row query over roles overlapping the window, not a day-by-day scan per
 * person, and finance questions routinely reach back over prior years.
 */
export const MAX_FINANCE_RANGE_DAYS = 1096;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * A role as the finance report needs it: everything {@link MarginRoleInput}
 * carries, plus the two fields the *report* needs and the margin math
 * deliberately does not.
 *
 * `lineOfBusiness` is absent from `MarginRoleInput` on purpose — that module never
 * resolves the rate card, so the card's second key is none of its business. It is
 * carried here for filtering and for the off-standard marker **only**, and must
 * never be routed back into the margin math: pricing a stored plan from today's
 * card is the retroactive repricing ADR 0066 removed.
 */
export type FinanceRoleInput = MarginRoleInput & {
  lineOfBusiness: LineOfBusiness;
};

/** A project and its plan, as the read projects it. */
export type FinanceProjectInput = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  billing: MarginBilling;
  /** Every role on the project, including ones outside the window. */
  roles: readonly FinanceRoleInput[];
};

export type FinanceInputs = {
  range: ReportRange;
  projects: readonly FinanceProjectInput[];
  /** Company-wide average hourly cost per role type, in USD. Absent ⇒ no basis. */
  openRoleCostUsd: Partial<Record<ProjectRoleType, number>>;
  displayCurrency: DisplayCurrency;
  usdRates: Record<Currency, number>;
  /** False when the viewer has no cost basis — every cost/margin figure is null. */
  includeCost: boolean;
  /** Keep only roles in this practice; null ⇒ the whole portfolio. */
  lineOfBusiness: LineOfBusiness | null;
};

// ---------------------------------------------------------------------------
// Windowing — the one piece of arithmetic this module owns
// ---------------------------------------------------------------------------

/**
 * The role with its span narrowed to the window, or **null** when the two don't
 * overlap at all.
 *
 * Null rather than a zero-hour role because an inclusive `startDate`/`endDate`
 * pair cannot express "no days": the narrowest it goes is one. A non-overlapping
 * role is therefore dropped from the in-period set, which is also why
 * `inPeriod.countedRoleCount` reads as "roles active in the period" — a figure
 * worth surfacing rather than an accident.
 */
export function clipRoleToWindow<
  T extends { startDate: string; endDate: string },
>(role: T, window: ReportRange): T | null {
  // "YYYY-MM-DD" is zero-padded, so a lexicographic compare is chronological.
  const startDate =
    role.startDate > window.start ? role.startDate : window.start;
  const endDate = role.endDate < window.end ? role.endDate : window.end;
  if (startDate > endDate) return null;
  return { ...role, startDate, endDate };
}

/**
 * The fraction of a fixed fee a slice of a plan recognizes: Σ billable hours of
 * `roles` (clipped to `window`, when one is given) ÷ Σ **whole-span** billable
 * hours of `allRoles`. Cancelled roles are excluded from both, via
 * `countsTowardBudget`, so the numerator and denominator are counted the way
 * revenue is.
 *
 * ⚠️ **The denominator is always the whole plan, never the slice.** Dividing by the
 * slice's own hours would make every share 1 — so a line-of-business filter would
 * report the entire fee against one practice, and the five per-practice views of a
 * multi-practice engagement would each claim the whole fee. With the whole plan
 * underneath, the shares partition: the practices sum to 1, contiguous windows sum
 * to 1, and a filter combined with a window multiplies out correctly.
 *
 * Zero — not one — when the plan has no billable hours at all, so a project with
 * nothing but cancelled roles recognizes no revenue rather than its whole fee in
 * every window it touches.
 */
export function feeRecognitionShare({
  roles,
  allRoles,
  window,
}: {
  /** The slice being priced — LOB-filtered, and clipped when `window` is set. */
  roles: readonly MarginRoleInput[];
  /** Every role on the project, whatever its practice or dates. */
  allRoles: readonly MarginRoleInput[];
  /** Omit to measure a slice's share of the plan without narrowing by date. */
  window?: ReportRange;
}): number {
  let total = 0;
  for (const role of allRoles) {
    if (!countsTowardBudget(role.status)) continue;
    total += roleBillableHours(role);
  }
  if (total === 0) return 0;

  let counted = 0;
  for (const role of roles) {
    if (!countsTowardBudget(role.status)) continue;
    const slice = window ? clipRoleToWindow(role, window) : role;
    if (slice) counted += roleBillableHours(slice);
  }
  return counted / total;
}

/**
 * The same billing model with a fixed fee scaled to `share` — how proration is
 * expressed, and the reason `project-margin.ts` needed no changes: it already
 * converts and reports `budgetAmount` as the fee, so handing it a scaled fee
 * yields a scaled revenue, a scaled margin, and an unchanged margin *percentage*
 * relative to the equally-scaled cost.
 *
 * A non-FIXED_FEE model passes through untouched. T&M needs no scaling — its
 * revenue is the sum of its roles' hours, which the clip has already narrowed —
 * and a project with no billing type has nothing to scale.
 */
export function scaleFixedFee(
  billing: MarginBilling,
  share: number,
): MarginBilling {
  if (billing.billingType !== "FIXED_FEE" || billing.budgetAmount == null) {
    return billing;
  }
  return { ...billing, budgetAmount: billing.budgetAmount * share };
}

// ---------------------------------------------------------------------------
// Per-project
// ---------------------------------------------------------------------------

/**
 * One project's figures on one time basis — a `ProjectMargin` with its **per-role
 * rows dropped**.
 *
 * ⚠️ This trim is a disclosure boundary, not a payload optimization. A
 * `RoleMargin` carries `cost` and `hours`, and on a single-assignee role
 * `cost ÷ hours` **is** that person's hourly compensation — which `× 2080` is their
 * salary. `ProjectFinance` is a prop of a Client Component, so anything left on it
 * is serialized into the page HTML for every project in the portfolio at once.
 * Every reader here holds `projects.viewMargin` and could assemble the same figure
 * one project at a time, but "reachable per project on request" and "shipped for
 * the whole book in one document" are different exposures, and the second is the
 * one this report has no need for: the page renders totals only.
 *
 * Built field-by-field by {@link projectBasis}, **never by a spread** — the ADR
 * 0063 §5 rule, which exists precisely so that adding a field to `ProjectMargin`
 * cannot silently put it on the wire.
 */
export type ProjectBasisFigures = {
  billingType: BillingType | null;
  /** False when the viewer has no cost basis — every cost/margin field is null. */
  includesCost: boolean;
  totals: BudgetTotals;
  /** Roles counted toward the budget. For `inPeriod`: roles active in the period. */
  countedRoleCount: number;
  openRoleCount: number;
  unknownCostRoleCount: number;
  convertedFrom: Currency[];
};

export type ProjectFinance = {
  projectId: string;
  name: string;
  companyId: string;
  companyName: string;
  /** Derived from the (filtered) roles — a project stores neither. */
  linesOfBusiness: LineOfBusiness[];
  status: ProjectRoleStatus;
  /** Earliest / latest role date across the whole plan; null with no roles. */
  startDate: string | null;
  endDate: string | null;
  billingType: BillingType | null;
  /** The whole plan, whatever its dates. */
  overall: ProjectBasisFigures;
  /** The plan clipped to the window, with a fixed fee prorated into it. */
  inPeriod: ProjectBasisFigures;
  /**
   * The fraction of a fixed fee the in-period column recognizes, or null when the
   * project doesn't bill a fee. Shipped so the UI can show *why* an in-period
   * figure is smaller than the overall one without recomputing the share. Under a
   * line-of-business filter this is the combined practice × window share.
   */
  feeShare: number | null;
};

/**
 * One project's revenue, cost and margin, both over its whole plan and within the
 * window.
 *
 * `roles` should already be LOB-filtered by the caller — the share is computed
 * over whatever is passed, which is what makes a filtered view prorate the fee
 * consistently with an unfiltered one.
 */
export function computeProjectFinance({
  project,
  roles,
  window,
  openRoleCostUsd,
  displayCurrency,
  usdRates,
  includeCost,
}: {
  project: FinanceProjectInput;
  roles: readonly FinanceRoleInput[];
  window: ReportRange;
  openRoleCostUsd: Partial<Record<ProjectRoleType, number>>;
  displayCurrency: DisplayCurrency;
  usdRates: Record<Currency, number>;
  includeCost: boolean;
}): ProjectFinance {
  const shared = { openRoleCostUsd, displayCurrency, usdRates, includeCost };
  const allRoles = project.roles;

  // Both bases scale, and for the same reason: `roles` may be a line-of-business
  // slice of the plan, and a slice must not carry the whole fee. Unfiltered,
  // `practiceShare` is exactly 1 and `overall` is the untouched plan — so a project
  // page and this report agree to the dollar on the unfiltered view, which is the
  // one a reader is most likely to cross-check.
  const practiceShare = feeRecognitionShare({ roles, allRoles });
  const overall = computeProjectMargin({
    billing: scaleFixedFee(project.billing, practiceShare),
    roles,
    ...shared,
  });

  const periodShare = feeRecognitionShare({ roles, allRoles, window });
  const clipped = roles
    .map((role) => clipRoleToWindow(role, window))
    .filter((role): role is FinanceRoleInput => role !== null);

  const inPeriod = computeProjectMargin({
    billing: scaleFixedFee(project.billing, periodShare),
    roles: clipped,
    ...shared,
  });

  // The whole plan's span, not the window's — a reader comparing the two columns
  // needs to know how much of the engagement sits outside what they're looking at.
  let startDate: string | null = null;
  let endDate: string | null = null;
  for (const role of roles) {
    if (startDate === null || role.startDate < startDate) {
      startDate = role.startDate;
    }
    if (endDate === null || role.endDate > endDate) endDate = role.endDate;
  }

  return {
    projectId: project.id,
    name: project.name,
    companyId: project.companyId,
    companyName: project.companyName,
    linesOfBusiness: deriveProjectLinesOfBusiness(
      roles.map((role) => role.lineOfBusiness),
    ),
    status: deriveProjectStatus(roles.map((role) => role.status)),
    startDate,
    endDate,
    billingType: project.billing.billingType,
    overall: projectBasis(overall),
    inPeriod: projectBasis(inPeriod),
    feeShare: project.billing.billingType === "FIXED_FEE" ? periodShare : null,
  };
}

/**
 * A `ProjectMargin` trimmed to what may cross to the browser.
 *
 * **Enumerated field by field, never spread** — per ADR 0063 §5, and here the rule
 * is load-bearing rather than merely tidy: `perRole` and `byRoleId` carry per-role
 * cost, from which an individual's compensation is one division away (see
 * {@link ProjectBasisFigures}). A spread would ship them, and would ship whatever
 * `ProjectMargin` gains next, silently.
 *
 * `displayCurrency` is dropped too: the report states it once at the top, and a
 * per-project copy could only ever agree or be a bug.
 */
function projectBasis(margin: ProjectMargin): ProjectBasisFigures {
  return {
    billingType: margin.billingType,
    includesCost: margin.includesCost,
    totals: margin.totals,
    countedRoleCount: margin.countedRoleCount,
    openRoleCount: margin.openRoleCount,
    unknownCostRoleCount: margin.unknownCostRoleCount,
    convertedFrom: margin.convertedFrom,
  };
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

/** Portfolio revenue, cost and margin over one of the two time bases. */
export type FinanceTotals = {
  hours: number;
  revenue: number | null;
  cost: number | null;
  margin: number | null;
  marginPercent: number | null;
  /**
   * Revenue ÷ hours — what an hour of this portfolio actually earns. Includes
   * fixed-fee work, because at portfolio level a fee *is* revenue and the hours
   * behind it are known; null when there are no hours to divide by.
   */
  blendedRate: number | null;
  /** Projects contributing at least one counted role on this basis. */
  projectCount: number;
  /** Counted roles on this basis — "roles active in the period" for `inPeriod`. */
  roleCount: number;
  /**
   * Counted roles with no derivable cost, so the cost total is **partial rather
   * than deflated**. Zero when the viewer has no cost basis at all (then every
   * cost figure is null and partiality is not the story).
   */
  unknownCostRoleCount: number;
  /**
   * Projects with no billing type set, whose revenue is `null` rather than 0.
   * Surfaced for the same reason: a total missing three projects must not read as
   * a total that is simply smaller.
   */
  projectsWithoutBillingType: number;
};

/** Blended and card rates for one discipline, over the window. */
export type DisciplineRate = {
  roleType: ProjectRoleType;
  /** Counted in-window hours across every billing model. */
  hours: number;
  /**
   * Hours-weighted mean of the roles' own stored `billRate`, in the display
   * currency. Defined for **every** counted role including fixed-fee ones: a rate
   * is what the row says it bills at, and unlike an amount it cannot be mistaken
   * for a share of a fee.
   */
  cardRate: number | null;
  /**
   * Revenue ÷ hours, over **time-and-materials roles only** — the one basis on
   * which a discipline's revenue is a fact rather than an apportionment (ADR
   * 0066). Null for a discipline whose in-window hours are all fixed-fee.
   */
  blended: number | null;
  /** The hours `blended` actually covers, so its coverage is legible. */
  timeAndMaterialsHours: number;
};

/**
 * The portfolio's fixed-fee book against the same roles priced hourly — the
 * project-level `hourlyValue` comparator (ADR 0066) rolled up.
 *
 * Revenue-side only, so it needs no cost basis. Deliberately **uncoloured** in the
 * UI: a fee negotiated below role rates is a commercial decision, not a loss.
 */
export type FixedFeeRollup = {
  projectCount: number;
  /** Σ recognized fee across fixed-fee projects. */
  revenue: number | null;
  /** Σ the same roles priced at their own stored hourly rates. */
  hourlyValue: number | null;
  /** `revenue − hourlyValue`. Negative = a discount, positive = a premium. */
  delta: number | null;
  /** `delta / hourlyValue`; null when the comparator is 0. */
  deltaPercent: number | null;
};

/**
 * How much of the book rides on roles priced away from **today's** rate card.
 *
 * Measured in hours and in *amount at role rates* (rate × hours) rather than in
 * revenue, because revenue is not attributable per role on a fixed fee — this
 * metric must not become a back door to the apportionment the rest of the module
 * refuses.
 *
 * "Off standard" conflates a negotiated rate with a card that has since moved, per
 * `isOffStandardRate`, and that is the intended reading: stale prices are the
 * failure mode worth surfacing. Note it reads near-zero while `DEFAULT_BILL_RATE`
 * is a flat placeholder with no exceptions — that is the card being uniform, not
 * the measure being broken.
 */
export type OffStandardExposure = {
  roleCount: number;
  hours: number;
  /** Rate × hours on off-card roles, in the display currency. */
  amountAtRoleRates: number;
  /** The same figure across every counted role — the denominator. */
  totalAtRoleRates: number;
  /** `amountAtRoleRates / totalAtRoleRates`; null when there is nothing priced. */
  share: number | null;
};

export type FinanceReport = {
  range: ReportRange;
  displayCurrency: DisplayCurrency;
  /** False when the viewer has no cost basis — every cost/margin figure is null. */
  includesCost: boolean;
  lineOfBusiness: LineOfBusiness | null;
  /** The whole plans of every project active in the window. */
  overall: FinanceTotals;
  /** Those plans clipped to the window, fixed fees prorated. */
  inPeriod: FinanceTotals;
  /** One row per project active in the window, in-period revenue first. */
  projects: ProjectFinance[];
  rates: DisciplineRate[];
  fixedFee: FixedFeeRollup;
  offStandard: OffStandardExposure;
  /** Currencies a rate was applied to, for the FX note. Canonical order. */
  convertedFrom: Currency[];
};

/**
 * Build the whole report for one display currency.
 *
 * Called once per {@link DISPLAY_CURRENCIES} entry by the read, so no per-person
 * cost ever has to reach the browser for the currency toggle to work — the
 * projects-list posture (`listMargin`), not the detail page's client-side
 * recompute. Percentages come out identical in both branches; only amounts move.
 */
export function buildFinanceReport({
  range,
  projects,
  openRoleCostUsd,
  displayCurrency,
  usdRates,
  includeCost,
  lineOfBusiness,
}: FinanceInputs): FinanceReport {
  const rows: ProjectFinance[] = [];

  for (const project of projects) {
    // Filtering keeps matching ROLES: line of business is a role's field, and a
    // project can span several practices. A project left with none is not "a
    // project with zero revenue in this practice" — it is not in this practice at
    // all, so it drops out rather than padding the table with empty rows.
    const roles =
      lineOfBusiness == null
        ? project.roles
        : project.roles.filter(
            (role) => role.lineOfBusiness === lineOfBusiness,
          );
    if (roles.length === 0) continue;

    const row = computeProjectFinance({
      project,
      roles,
      window: range,
      openRoleCostUsd,
      displayCurrency,
      usdRates,
      includeCost,
    });

    // A project whose every role falls outside the window is not active in it.
    // The read's overlap predicate already excludes these, but the LOB filter can
    // strand one: its in-window roles may all belong to another practice.
    if (row.inPeriod.countedRoleCount === 0) continue;
    rows.push(row);
  }

  // Descending in-period revenue — what the reader came for. Nulls (no billing
  // type) sort last so an unpriced project can't head the table, with name as the
  // tiebreak so equal figures stay stable.
  rows.sort((a, b) => {
    const left = a.inPeriod.totals.revenue;
    const right = b.inPeriod.totals.revenue;
    if (left == null && right == null) return a.name.localeCompare(b.name);
    if (left == null) return 1;
    if (right == null) return -1;
    if (left !== right) return right - left;
    return a.name.localeCompare(b.name);
  });

  const convertedFrom = new Set<Currency>();
  for (const row of rows) {
    for (const code of row.overall.convertedFrom) convertedFrom.add(code);
    for (const code of row.inPeriod.convertedFrom) convertedFrom.add(code);
  }

  return {
    range,
    displayCurrency,
    includesCost: includeCost,
    lineOfBusiness,
    overall: sumTotals(rows.map((row) => row.overall)),
    inPeriod: sumTotals(rows.map((row) => row.inPeriod)),
    projects: rows,
    rates: buildDisciplineRates({
      projects: rows,
      inputs: projects,
      range,
      lineOfBusiness,
      displayCurrency,
      usdRates,
    }),
    fixedFee: buildFixedFeeRollup(rows),
    offStandard: buildOffStandardExposure({
      projects,
      rows,
      range,
      lineOfBusiness,
      displayCurrency,
      usdRates,
    }),
    // Canonical order, so the rate list reads the same way every render — the
    // same discipline `convertedFrom` uses in `project-margin.ts`.
    convertedFrom: CURRENCY.filter((code) => convertedFrom.has(code)),
  };
}

/** Sum the amounts that are known, ignoring the nulls. */
function sumKnown(amounts: readonly (number | null)[]): number {
  return amounts.reduce<number>((total, amount) => total + (amount ?? 0), 0);
}

/**
 * Roll a set of per-project margins into portfolio totals.
 *
 * Nulls contribute nothing rather than a zero, so a total is **partial rather than
 * deflated** — the discipline `computeProjectMargin` already applies within a
 * project, applied again one level up. `unknownCostRoleCount` and
 * `projectsWithoutBillingType` are what let the UI say how partial.
 *
 * Margin is recomputed from the summed revenue and cost rather than summed
 * directly: summing per-project margins would silently treat a project with known
 * revenue and unknown cost as contributing zero margin, which is a stronger claim
 * than "we don't know".
 */
function sumTotals(margins: readonly ProjectBasisFigures[]): FinanceTotals {
  const hours = margins.reduce((total, m) => total + m.totals.hours, 0);
  const anyCost = margins.some((m) => m.includesCost);

  const revenue = margins.some((m) => m.totals.revenue != null)
    ? sumKnown(margins.map((m) => m.totals.revenue))
    : null;
  const cost = anyCost ? sumKnown(margins.map((m) => m.totals.cost)) : null;

  const margin = revenue == null || cost == null ? null : revenue - cost;

  return {
    hours,
    revenue,
    cost,
    margin,
    // Same zero-denominator rule as `marginOf`: a portfolio with no revenue
    // reports "—" rather than a triumphant 100%.
    marginPercent:
      margin != null && revenue != null && revenue > 0
        ? margin / revenue
        : null,
    blendedRate: hours > 0 && revenue != null ? revenue / hours : null,
    projectCount: margins.filter((m) => m.countedRoleCount > 0).length,
    roleCount: margins.reduce((total, m) => total + m.countedRoleCount, 0),
    unknownCostRoleCount: margins.reduce(
      (total, m) => total + m.unknownCostRoleCount,
      0,
    ),
    projectsWithoutBillingType: margins.filter((m) => m.billingType == null)
      .length,
  };
}

/**
 * Blended and card rates per discipline, over the **in-period** clip.
 *
 * Walks the raw inputs again rather than reading per-role margins: a `RoleMargin`
 * carries no `roleType`, so grouping needs the input rows — and per-role figures are
 * deliberately not on `ProjectFinance` at all (see {@link ProjectBasisFigures}). The
 * clip and the filter are reapplied identically so the hours here reconcile with
 * `inPeriod.hours`.
 */
function buildDisciplineRates({
  projects,
  inputs,
  range,
  lineOfBusiness,
  displayCurrency,
  usdRates,
}: {
  /** The rows that survived the filter — the set whose hours must reconcile. */
  projects: readonly ProjectFinance[];
  inputs: readonly FinanceProjectInput[];
  range: ReportRange;
  lineOfBusiness: LineOfBusiness | null;
  displayCurrency: DisplayCurrency;
  usdRates: Record<Currency, number>;
}): DisciplineRate[] {
  const included = new Set(projects.map((row) => row.projectId));
  const byType = new Map<
    ProjectRoleType,
    { hours: number; rateHours: number; tmHours: number; tmRevenue: number }
  >();

  for (const project of inputs) {
    if (!included.has(project.id)) continue;
    const isTimeAndMaterials =
      project.billing.billingType === "TIME_AND_MATERIALS";

    for (const role of project.roles) {
      if (lineOfBusiness != null && role.lineOfBusiness !== lineOfBusiness) {
        continue;
      }
      if (!countsTowardBudget(role.status)) continue;
      const clipped = clipRoleToWindow(role, range);
      if (!clipped) continue;

      const hours = roleBillableHours(clipped);
      const rate = convert(
        role.billRate,
        BILL_RATE_CURRENCY,
        displayCurrency,
        usdRates,
      );

      const bucket = byType.get(role.roleType) ?? {
        hours: 0,
        rateHours: 0,
        tmHours: 0,
        tmRevenue: 0,
      };
      bucket.hours += hours;
      bucket.rateHours += rate * hours;
      if (isTimeAndMaterials) {
        bucket.tmHours += hours;
        bucket.tmRevenue += rate * hours;
      }
      byType.set(role.roleType, bucket);
    }
  }

  // Canonical tuple order, so the table reads the same way every render, and only
  // disciplines that actually have hours — an empty row would invite reading "—"
  // as a rate of nothing.
  return PROJECT_ROLE_TYPES.flatMap((roleType) => {
    const bucket = byType.get(roleType);
    if (!bucket || bucket.hours === 0) return [];
    return [
      {
        roleType,
        hours: bucket.hours,
        cardRate: bucket.rateHours / bucket.hours,
        blended: bucket.tmHours > 0 ? bucket.tmRevenue / bucket.tmHours : null,
        timeAndMaterialsHours: bucket.tmHours,
      },
    ];
  });
}

/**
 * The fixed-fee book against the same roles priced hourly, over the in-period
 * clip — a straight sum of the per-project comparator `computeProjectMargin`
 * already produced, so the roll-up cannot disagree with any project's own panel.
 */
function buildFixedFeeRollup(rows: readonly ProjectFinance[]): FixedFeeRollup {
  const fixed = rows.filter((row) => row.billingType === "FIXED_FEE");
  if (fixed.length === 0) {
    return {
      projectCount: 0,
      revenue: null,
      hourlyValue: null,
      delta: null,
      deltaPercent: null,
    };
  }

  const revenue = sumKnown(fixed.map((row) => row.inPeriod.totals.revenue));
  const hourlyValue = sumKnown(
    fixed.map((row) => row.inPeriod.totals.hourlyValue),
  );
  const delta = revenue - hourlyValue;

  return {
    projectCount: fixed.length,
    revenue,
    hourlyValue,
    delta,
    deltaPercent: hourlyValue > 0 ? delta / hourlyValue : null,
  };
}

/**
 * Hours and amount-at-role-rates sitting on roles priced away from today's card,
 * over the in-period clip. Same walk as {@link buildDisciplineRates}, so the
 * denominator reconciles with the rate table's hours.
 */
function buildOffStandardExposure({
  projects,
  rows,
  range,
  lineOfBusiness,
  displayCurrency,
  usdRates,
}: {
  projects: readonly FinanceProjectInput[];
  rows: readonly ProjectFinance[];
  range: ReportRange;
  lineOfBusiness: LineOfBusiness | null;
  displayCurrency: DisplayCurrency;
  usdRates: Record<Currency, number>;
}): OffStandardExposure {
  const included = new Set(rows.map((row) => row.projectId));
  let roleCount = 0;
  let hours = 0;
  let amountAtRoleRates = 0;
  let totalAtRoleRates = 0;

  for (const project of projects) {
    if (!included.has(project.id)) continue;
    for (const role of project.roles) {
      if (lineOfBusiness != null && role.lineOfBusiness !== lineOfBusiness) {
        continue;
      }
      if (!countsTowardBudget(role.status)) continue;
      const clipped = clipRoleToWindow(role, range);
      if (!clipped) continue;

      const roleHours = roleBillableHours(clipped);
      const amount =
        convert(role.billRate, BILL_RATE_CURRENCY, displayCurrency, usdRates) *
        roleHours;
      totalAtRoleRates += amount;

      if (isOffStandardRate(role)) {
        roleCount += 1;
        hours += roleHours;
        amountAtRoleRates += amount;
      }
    }
  }

  return {
    roleCount,
    hours,
    amountAtRoleRates,
    totalAtRoleRates,
    share: totalAtRoleRates > 0 ? amountAtRoleRates / totalAtRoleRates : null,
  };
}
