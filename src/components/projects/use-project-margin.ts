"use client";

import { useMemo, useState } from "react";
import type {
  PlanBudget,
  PlanRole,
} from "@/actions/projects/getOpportunityPlan";
import type { PlanCostBasis } from "@/actions/projects/getProjectCostBasis";
import type { ExchangeRates } from "@/actions/staff/getExchangeRates";
import type { DisplayCurrency } from "@/lib/format/currency";
import {
  computeProjectMargin,
  resolveDisplayCurrency,
} from "@/lib/projects/project-margin";

/**
 * A project plan's budget figures plus the display currency they're shown in.
 *
 * The conversion happens here on the client, from native amounts and the rate table
 * the read shipped, so flipping CAD ↔ USD never refetches (ADR 0029). Both surfaces
 * that show a plan use this so their panel and their grid always agree.
 */
export function useProjectMargin({
  roles,
  budget,
  costBasis,
  exchangeRates,
}: {
  roles: PlanRole[];
  budget: PlanBudget;
  /** Null when the viewer lacks `projects.viewMargin` — cost is then never computed. */
  costBasis: PlanCostBasis | null;
  exchangeRates: ExchangeRates;
}) {
  // Lazily defaulted from the project's own denomination, then owned by the toggle.
  // It deliberately doesn't re-derive when the budget changes: once someone has a
  // currency on screen, re-pricing the project shouldn't move it under them.
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(() =>
    resolveDisplayCurrency({ budgetCurrency: budget.budgetCurrency }),
  );

  const margin = useMemo(
    () =>
      computeProjectMargin({
        billing: budget,
        roles: roles.map((role) => ({
          roleId: role.id,
          roleType: role.roleType,
          status: role.status,
          startDate: role.startDate,
          endDate: role.endDate,
          hoursPerDay: role.hoursPerDay,
          staffId: role.staffId,
          staffHourlyCost:
            (role.staffId && costBasis?.staffHourlyCost[role.staffId]) || null,
        })),
        openRoleCostUsd: costBasis?.openRoleCostUsd ?? {},
        displayCurrency,
        usdRates: exchangeRates.rates,
        includeCost: costBasis !== null,
      }),
    [roles, budget, costBasis, displayCurrency, exchangeRates.rates],
  );

  return { margin, displayCurrency, setDisplayCurrency };
}
