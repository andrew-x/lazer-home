"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { PlanBudget } from "@/actions/projects/getOpportunityPlan";
import type { ExchangeRates } from "@/actions/staff/getExchangeRates";
import { toEnumValue } from "@/components/form/enum-select";
import { FilterLabel } from "@/components/form/filters";
import { FxRateNote } from "@/components/fx-rate-note";
import { InlineNotice } from "@/components/inline-notice";
import { ProjectBudgetDialog } from "@/components/projects/budget-dialog";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/core/utils";
import {
  aggregateMoneyFormatters,
  DISPLAY_CURRENCIES,
  type DisplayCurrency,
  formatAmount,
  formatMoney,
} from "@/lib/format/currency";
import { formatPercent } from "@/lib/format/format";
import { BILLING_TYPE_LABELS } from "@/lib/projects/project-billing";
import {
  marginAmountTone,
  type ProjectMargin,
} from "@/lib/projects/project-margin";

/**
 * A project's money, above its planner grid: what the work earns, what it costs, and
 * the margin between them, in a CAD/USD display currency — with the exchange rates
 * used stated once beside that selector.
 *
 * A bordered panel rather than more `StatCard`s: the money figures shouldn't sit in
 * the same undifferentiated wrap as the date tiles, and this gives the currency
 * toggle, the FX note, the billing badge and the edit affordance somewhere to live.
 *
 * Cost and margin render **only** when the server sent a cost basis
 * (`projects.viewMargin`); revenue is not compensation-derived and always shows.
 */
export function BudgetSummaryPanel({
  projectId,
  budget,
  margin,
  rates,
  displayCurrency,
  onDisplayCurrencyChange,
  canManage,
  onSaved,
}: {
  projectId: string;
  budget: PlanBudget;
  margin: ProjectMargin;
  rates: ExchangeRates;
  displayCurrency: DisplayCurrency;
  onDisplayCurrencyChange: (currency: DisplayCurrency) => void;
  /** `projects.edit` — gates the edit/set-budget affordance, not the figures. */
  canManage: boolean;
  onSaved?: () => void;
}) {
  const editDialog = canManage ? (
    <ProjectBudgetDialog
      projectId={projectId}
      budget={budget}
      label={budget.billingType ? "Edit budget" : "Set budget"}
      onSaved={onSaved}
    />
  ) : null;

  // A project that predates budgets, or one linked from an existing project without
  // going through a create form. Nothing to convert, so no toggle either.
  if (!budget.billingType) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3">
        <p className="text-sm text-muted-foreground">
          No budget set for this project.
        </p>
        {editDialog}
      </div>
    );
  }

  const { money } = aggregateMoneyFormatters(displayCurrency);
  const { totals } = margin;

  return (
    <div className="flex flex-col gap-4 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-heading text-sm font-medium">
          Budget &amp; margin
        </h4>
        <Badge variant="outline">
          {BILLING_TYPE_LABELS[budget.billingType]}
        </Badge>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {/* The conversion caveat lives here, next to the control that causes it. */}
          <FxRateNote
            rates={rates}
            from={margin.convertedFrom}
            to={displayCurrency}
          />
          <ToggleGroup
            variant="outline"
            spacing={0}
            aria-label="Display currency"
            value={[displayCurrency]}
            onValueChange={(values: string[]) => {
              // Base UI emits an empty array when the active item is pressed again;
              // a display currency is never "none", so ignore that.
              const next = toEnumValue(DISPLAY_CURRENCIES, values[0] ?? null);
              if (next) onDisplayCurrencyChange(next);
            }}
          >
            {DISPLAY_CURRENCIES.map((code) => (
              <ToggleGroupItem key={code} value={code} size="sm">
                {code}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {editDialog}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <BudgetFigure
          label="Revenue"
          value={money(totals.revenue)}
          hint={
            budget.billingType === "FIXED_FEE" ? (
              <>
                {budget.budgetAmount != null && budget.budgetCurrency ? (
                  <p>
                    Fixed fee ·{" "}
                    {formatMoney(budget.budgetAmount, budget.budgetCurrency, {
                      maximumFractionDigits: 0,
                    })}
                  </p>
                ) : null}
                <HourlyValueLine margin={margin} />
              </>
            ) : (
              `${formatAmount(Math.round(totals.hours))} hrs at role rates`
            )
          }
        />

        {margin.includesCost ? (
          <>
            <BudgetFigure
              label="Cost"
              value={money(totals.cost)}
              hint={roleCountHint(margin)}
            />
            {/* The money is the headline and the percentage supports it: what a
                plan earns is the decision, and the rate is how to read it. */}
            <BudgetFigure
              label="Margin"
              value={
                <span className={cn(marginAmountTone(totals.margin))}>
                  {money(totals.margin)}
                </span>
              }
              hint={
                totals.marginPercent != null
                  ? formatPercent(totals.marginPercent)
                  : undefined
              }
            />
          </>
        ) : null}
      </div>

      {margin.countedRoleCount === 0 ? (
        <InlineNotice>
          No roles on this plan yet, so there's nothing to cost against the
          budget.
        </InlineNotice>
      ) : null}

      {margin.unknownCostRoleCount > 0 ? (
        <InlineNotice icon={IconAlertTriangle}>
          {plural(margin.unknownCostRoleCount, "role has", "roles have")} no
          compensation on record, so the cost total is incomplete.
        </InlineNotice>
      ) : null}
    </div>
  );
}

/**
 * One headline figure. `StatCard`'s typography without its `Card`: nesting a bordered
 * card inside a bordered panel fights the flat-surface design language, and `value`
 * is a node rather than a string so the margin can carry its loss colouring.
 */
function BudgetFigure({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  /** A node, not just a string, so a figure can carry more than one line of context. */
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <FilterLabel>{label}</FilterLabel>
      <div className="text-2xl font-semibold">{value}</div>
      {hint ? (
        <div className="text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

/**
 * What a fixed fee would have come to at the roles' own hourly rates, and the discount
 * or premium between the two — the only place a fee becomes legible as a commercial
 * decision rather than just a number.
 *
 * Three deliberate choices:
 *
 * - **No colour.** A discount is a negotiation, not a loss, and this codebase colours
 *   only losses (there is no success token, so a premium can't be green either). Margin
 *   keeps the sole tone on this panel.
 * - **Rendered outside the `includesCost` branch.** The comparator is revenue-side, so a
 *   viewer without `projects.viewMargin` still sees it. Nesting it beside Cost would gate
 *   a figure that isn't compensation-derived.
 * - **Rounded before the sign and the word are chosen**, so a delta that renders as
 *   "CA$0" reads "at role rates" instead of a signed zero — the same rule
 *   `marginAmountTone` follows.
 */
function HourlyValueLine({ margin }: { margin: ProjectMargin }) {
  const { hourlyValue, hourlyValueDelta, hourlyValueDeltaPercent } =
    margin.totals;
  // A plan with no counted roles already says so in its own notice below.
  if (hourlyValue == null || hourlyValueDelta == null) return null;
  if (margin.countedRoleCount === 0) return null;

  const { money } = aggregateMoneyFormatters(margin.displayCurrency);
  const rounded = Math.round(hourlyValueDelta);

  return (
    <p>
      {money(hourlyValue)} at role rates
      {rounded === 0
        ? null
        : ` · ${money(Math.abs(hourlyValueDelta))} ${rounded < 0 ? "discount" : "premium"}${
            hourlyValueDeltaPercent == null
              ? ""
              : ` (${formatPercent(Math.abs(hourlyValueDeltaPercent))})`
          }`}
    </p>
  );
}

/** "8 roles · 2 open" — how the cost total was assembled. */
function roleCountHint(margin: ProjectMargin): string {
  const roles = `${margin.countedRoleCount} ${margin.countedRoleCount === 1 ? "role" : "roles"}`;
  return margin.openRoleCount > 0
    ? `${roles} · ${margin.openRoleCount} open (estimated)`
    : roles;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
