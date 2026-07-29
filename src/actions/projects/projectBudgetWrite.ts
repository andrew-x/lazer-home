import "server-only";

import type { ProjectBudget } from "./projectBudget.schema";

/**
 * The three `projects` budget columns for a parsed budget, shared by the two create
 * actions and `updateProjectBudget`.
 *
 * The explicit nulls on the time-and-materials branch are load-bearing on the UPDATE
 * path: switching a project from a fixed fee to T&M must CLEAR the total, or the
 * `projects_budget_shape` check constraint rejects the write. Spelling them out means
 * the same function serves insert and update.
 *
 * There is nothing else to write — a T&M project bills at the standard rate card in
 * `@/lib/projects/bill-rates`, so it stores no rates of its own.
 */
export function projectBudgetColumns(budget: ProjectBudget) {
  return budget.billingType === "FIXED_FEE"
    ? {
        billingType: budget.billingType,
        budgetAmount: budget.budgetAmount,
        budgetCurrency: budget.budgetCurrency,
      }
    : {
        billingType: budget.billingType,
        budgetAmount: null,
        budgetCurrency: null,
      };
}
