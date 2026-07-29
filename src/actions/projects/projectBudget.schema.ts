import { z } from "zod";
import { CURRENCY } from "@/lib/format/currency";

/**
 * The budget fields shared by every flow that sets a project's billing model —
 * `createProject`, `createProjectFromOpportunity`, and `updateProjectBudget`. A
 * pure, client-importable module (no `db`/drizzle) so the create dialogs' resolvers
 * and the three server actions all validate identically.
 *
 * A **discriminated union**, not one flat object with `superRefine`: only a fixed fee
 * carries a total, so the union makes a time-and-materials budget that smuggles an
 * amount unrepresentable in the inferred type rather than merely invalid at runtime.
 * The action bodies then `switch` on `billingType` with each half narrowed. It is the
 * same rule the `projects_budget_shape` check constraint enforces in the DB.
 *
 * Time and materials takes **no input at all**: it bills hours at the company's
 * standard rate card, which lives in code (`@/lib/projects/bill-rates`) rather than
 * per project. Picking the billing type is the whole decision.
 *
 * See docs/domains/projects.md and
 * docs/decisions/0052-project-budgets-and-margin.md.
 */

/** The largest value a `numeric(12, 2)` column holds. */
const MAX_MONEY = 9_999_999_999.99;

export const projectBudgetSchema = z.discriminatedUnion("billingType", [
  z.object({
    billingType: z.literal("FIXED_FEE"),
    // `.positive()` is load-bearing, not decoration: `z.coerce.number()` turns the
    // empty string a blank input submits into 0, so without it an untouched field
    // would save a $0 budget instead of failing with a message.
    budgetAmount: z.coerce
      .number()
      .positive("Enter a budget greater than 0.")
      .max(MAX_MONEY, "That budget is too large."),
    budgetCurrency: z.enum(CURRENCY),
  }),
  z.object({ billingType: z.literal("TIME_AND_MATERIALS") }),
]);

/** The canonical input type for the budget half of every project write. */
export type ProjectBudgetInput = z.input<typeof projectBudgetSchema>;

/** The parsed budget the actions write — coerced numbers, narrowed by `billingType`. */
export type ProjectBudget = z.output<typeof projectBudgetSchema>;
