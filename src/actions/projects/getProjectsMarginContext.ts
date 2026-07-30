import "server-only";

import { cache } from "react";
import {
  getProjectCostBasis,
  type PlanCostBasis,
} from "@/actions/projects/getProjectCostBasis";
import {
  type ExchangeRates,
  getExchangeRates,
} from "@/actions/staff/getExchangeRates";
import { db } from "@/lib/db/db";
import { projectRoles, projects } from "@/lib/db/schema";
import { CURRENCY, type Currency } from "@/lib/format/currency";
import { BILL_RATE_CURRENCY } from "@/lib/projects/bill-rates";

/** Everything the projects list needs to price a page of projects, fetched once. */
export type ProjectsMarginContext = {
  rates: ExchangeRates;
  /** Null when the viewer lacks `projects.viewMargin` — no margin anywhere in the list. */
  costBasis: PlanCostBasis | null;
  /**
   * The currencies a rate could be applied to anywhere in the list, in canonical
   * order — the input to the FX note beside the currency control.
   *
   * Deliberately **list-scoped**, not page-scoped: `ProjectMargin.convertedFrom`
   * records the currencies one project actually converted from, and a budget panel
   * states exactly that (it warns against inferring the caveat from inputs, since
   * that overstates it). But the list's control converts every card at once, so the
   * caveat belongs to the list, and the honest alternative — threading a per-project,
   * per-currency `convertedFrom` up through five independently paginated sections —
   * would put per-role provenance in the payload to qualify a single footnote. The
   * cost of this choice: a filtered view showing one CAD project can still quote a
   * rate for a currency only some other project is priced in.
   */
  nativeCurrencies: Currency[];
};

/**
 * The shared cost/FX inputs for margin on the projects **list**, resolved once per
 * request.
 *
 * Deliberately request-scoped rather than per-list-call: the grouped view fires five
 * list reads in parallel (Tentative / Paused / Active / Past / Cancelled), and
 * `getRoleTypeAverageCostsUsd` inside the cost basis scans all of
 * `staff_employment`. `cache()` memoizes the *promise*, so those five concurrent
 * callers share one fetch instead of repeating it five times.
 *
 * That request scope is also why the cost basis covers every staff member on any
 * project role rather than just the rows on the current page: a page-scoped id list
 * would be a different cache key per section and defeat the sharing, for one extra
 * `where` on a query that runs either way.
 *
 * Cost still comes **only** from `getProjectCostBasis`, which is the one place the
 * `projects.viewMargin` decision is made.
 */
export const getProjectsMarginContext = cache(
  async (): Promise<ProjectsMarginContext> => {
    const [rates, roleStaffRows, budgetRows] = await Promise.all([
      getExchangeRates(),
      // Nulls are kept, not filtered: a null row IS the fact "at least one role is
      // open", which is what decides whether the USD role-type averages get used.
      db.selectDistinct({ staffId: projectRoles.staffId }).from(projectRoles),
      db
        .selectDistinct({
          billingType: projects.billingType,
          budgetCurrency: projects.budgetCurrency,
        })
        .from(projects),
    ]);

    const staffIds = roleStaffRows
      .map((row) => row.staffId)
      .filter((id): id is string => id !== null);
    const hasOpenRole = roleStaffRows.some((row) => row.staffId === null);

    const costBasis = await getProjectCostBasis({
      staffIds,
      usdRates: rates.rates,
    });

    // Only currencies a figure is genuinely converted *from*, so the note never
    // quotes a rate nothing was priced at: a fixed fee's own denomination, the rate
    // card's currency when any project bills T&M, USD when an open role is costed
    // from the per-discipline averages, and each assignee's compensation currency.
    const natives = new Set<Currency>();
    for (const row of budgetRows) {
      if (row.budgetCurrency) natives.add(row.budgetCurrency);
      if (row.billingType === "TIME_AND_MATERIALS")
        natives.add(BILL_RATE_CURRENCY);
    }
    if (costBasis) {
      if (hasOpenRole && Object.keys(costBasis.openRoleCostUsd).length > 0) {
        natives.add("USD");
      }
      for (const cost of Object.values(costBasis.staffHourlyCost)) {
        natives.add(cost.currency);
      }
    }

    return {
      rates,
      costBasis,
      nativeCurrencies: CURRENCY.filter((code) => natives.has(code)),
    };
  },
);
