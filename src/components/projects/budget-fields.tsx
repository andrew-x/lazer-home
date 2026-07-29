"use client";

import type {
  Control,
  FieldErrors,
  FieldPath,
  UseFormRegister,
} from "react-hook-form";
import { Controller } from "react-hook-form";
import type { ProjectBudgetInput } from "@/actions/projects/projectBudget.schema";
import type { IssueTarget } from "@/components/form/apply-server-issues";
import { EnumSelect } from "@/components/form/enum-select";
import { FormField } from "@/components/form/form-field";
import { Input } from "@/components/ui/input";
import {
  CURRENCY,
  CURRENCY_LABELS,
  type Currency,
  formatMoney,
} from "@/lib/format/currency";
import {
  BILL_RATE_CURRENCY,
  BILL_RATES,
  BILL_RATES_REVIEWED_ON,
  isFlatRateCard,
  standardRateCard,
} from "@/lib/projects/bill-rates";
import {
  BILLING_TYPE_LABELS,
  BILLING_TYPES,
  type BillingType,
} from "@/lib/projects/project-billing";
import { PROJECT_ROLE_TYPE_LABELS } from "@/lib/projects/project-role-type";

/**
 * The form shape behind every budget editor. Deliberately the mirror of
 * `RoleFormValues` / `RoleFields` in `role-fields.tsx`, and the client-side twin of
 * `projectBudgetSchema`.
 *
 * Only a fixed fee has fields; time and materials bills at the standard rate card and
 * so has nothing to collect. The fee values persist across a billing-type switch so
 * nothing you typed is lost, and `toBudgetInput` drops them when they don't apply.
 */
export type BudgetFormValues = {
  billingType: BillingType | "";
  budgetAmount: string;
  budgetCurrency: Currency | "";
};

/**
 * Every field name across both arms of the budget union. Plain `keyof` on a
 * discriminated union yields only the shared discriminant, so it would let the map
 * below omit the fee fields — the opposite of the exhaustiveness this typing exists
 * to enforce.
 */
type AllKeys<T> = T extends unknown ? keyof T : never;
type BudgetIssueKey = AllKeys<ProjectBudgetInput>;

const BUDGET_ISSUE_FIELDS: Record<
  BudgetIssueKey,
  IssueTarget<BudgetFormValues>
> = {
  billingType: "billingType",
  budgetAmount: "budgetAmount",
  budgetCurrency: "budgetCurrency",
};

/**
 * Maps each budget-schema field to its form field, for the host form's value type.
 * Typed by {@link BudgetIssueKey} so a new schema field can't silently drop its
 * errors.
 *
 * The caller must `safeParse` the **budget slice on its own**: the nested `budget`
 * key in `createProjectSchema` would give issue paths like
 * `["budget","budgetAmount"]`, and `applyServerIssues` routes on `path[0]`.
 *
 * A function rather than a plain constant because of the one cast below: `T` only ever
 * widens `BudgetFormValues`, so every path in the map is a valid `FieldPath<T>` — but
 * `FieldPath` is a conditional type, so tsc can't prove that subset relation and
 * compares the type arguments instead. Casting once here keeps all three call sites
 * clean.
 */
export function budgetIssueFields<T extends BudgetFormValues>(): Record<
  BudgetIssueKey,
  IssueTarget<T>
> {
  return BUDGET_ISSUE_FIELDS as Record<BudgetIssueKey, IssueTarget<T>>;
}

/** A blank budget form, or one primed from a project's existing budget. */
export function budgetDefaultValues(
  existing?: {
    billingType: BillingType | null;
    budgetAmount: number | null;
    budgetCurrency: Currency | null;
  } | null,
): BudgetFormValues {
  return {
    billingType: existing?.billingType ?? "",
    budgetAmount:
      existing?.budgetAmount != null ? String(existing.budgetAmount) : "",
    budgetCurrency: existing?.budgetCurrency ?? "",
  };
}

/**
 * The budget half of a project write, shaped for the schema. Drops the fee on the
 * time-and-materials branch, so flipping billing type twice can't smuggle a stale
 * total through.
 *
 * Returns `null` when no billing type is chosen yet — the caller passes that straight
 * to `safeParse`, which produces the "required" issue.
 */
export function toBudgetInput(
  values: BudgetFormValues,
): ProjectBudgetInput | null {
  if (values.billingType === "FIXED_FEE") {
    return {
      billingType: "FIXED_FEE",
      budgetAmount: values.budgetAmount,
      // An unselected currency is invalid; let the schema say so.
      budgetCurrency: values.budgetCurrency as Currency,
    };
  }
  if (values.billingType === "TIME_AND_MATERIALS") {
    return { billingType: "TIME_AND_MATERIALS" };
  }
  return null;
}

/**
 * How a project bills: one total fee, or hours at the company's standard rate card.
 *
 * Shared by all three flows that set a budget — the standalone create dialog, the
 * create-from-opportunity dialog, and the edit dialog — so the three can't drift.
 * Generic over the surrounding form's values because each host form carries extra
 * fields of its own.
 */
export function BudgetFields<T extends BudgetFormValues>({
  idPrefix,
  control,
  register,
  errors,
  billingType,
}: {
  idPrefix: string;
  control: Control<T>;
  register: UseFormRegister<T>;
  /** Typed against the shared shape — a wider form's `FieldErrors` is assignable. */
  errors: FieldErrors<BudgetFormValues>;
  /** The host form's `watch("billingType")`, so this component stays presentational. */
  billingType: BillingType | "";
}) {
  // Every path below exists on `BudgetFormValues`, and `T` only widens it, so this
  // narrowing is sound — it keeps all three call sites free of casts.
  const path = (key: FieldPath<BudgetFormValues>) => key as FieldPath<T>;

  return (
    <>
      <FormField label="Billing type" error={errors.billingType?.message}>
        <Controller
          control={control}
          name={path("billingType")}
          render={({ field, fieldState }) => (
            <EnumSelect
              options={BILLING_TYPES}
              labels={BILLING_TYPE_LABELS}
              placeholder="Select a billing type"
              value={(field.value ?? "") as BillingType | ""}
              invalid={Boolean(fieldState.error)}
              onValueChange={field.onChange}
            />
          )}
        />
      </FormField>

      {billingType === "FIXED_FEE" ? (
        <div className="flex gap-3">
          <FormField
            label="Total fee"
            htmlFor={`${idPrefix}-budget-amount`}
            error={errors.budgetAmount?.message}
            className="min-w-0 flex-1"
          >
            <Input
              id={`${idPrefix}-budget-amount`}
              type="number"
              inputMode="decimal"
              min="0"
              step="1000"
              placeholder="250000"
              className="tabular-nums"
              aria-invalid={Boolean(errors.budgetAmount)}
              {...register(path("budgetAmount"))}
            />
          </FormField>
          <FormField
            label="Currency"
            error={errors.budgetCurrency?.message}
            className="w-32 shrink-0"
          >
            <Controller
              control={control}
              name={path("budgetCurrency")}
              render={({ field, fieldState }) => (
                <EnumSelect
                  options={CURRENCY}
                  labels={CURRENCY_LABELS}
                  placeholder="Currency"
                  value={(field.value ?? "") as Currency | ""}
                  invalid={Boolean(fieldState.error)}
                  onValueChange={field.onChange}
                />
              )}
            />
          </FormField>
        </div>
      ) : null}

      {billingType === "TIME_AND_MATERIALS" ? <StandardRateCard /> : null}
    </>
  );
}

/**
 * The rate card a T&M project will bill at, read-only — there is nothing to decide
 * here, and showing the rates is the point: it's what makes "time & materials" a
 * priced choice rather than a blank cheque.
 *
 * Rendered from `BILL_RATES` rather than hardcoded copy, so a rate revision shows up
 * here without anyone remembering to update the form.
 */
function StandardRateCard() {
  const flatRate = isFlatRateCard()
    ? formatMoney(BILL_RATES.ENGINEER, BILL_RATE_CURRENCY, {
        maximumFractionDigits: 0,
      })
    : null;

  return (
    <FormField label="Rate card">
      <div className="flex flex-col gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
        {flatRate ? (
          <p>
            Billed hourly at the standard rate card — {flatRate}/hr for every
            discipline.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {standardRateCard().map((row) => (
              <li key={row.roleType} className="flex justify-between gap-4">
                <span>{PROJECT_ROLE_TYPE_LABELS[row.roleType]}</span>
                <span className="tabular-nums">
                  {formatMoney(row.hourlyRate, row.currency, {
                    maximumFractionDigits: 0,
                  })}
                  /hr
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Company-wide and set in code, not per project — last reviewed{" "}
          {BILL_RATES_REVIEWED_ON}.
        </p>
      </div>
    </FormField>
  );
}
