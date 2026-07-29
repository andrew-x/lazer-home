/**
 * How a project bills. Declared here as a pure, client-importable module (no
 * `db`/drizzle) so the `projectBillingTypeEnum` pgEnum in `projects-schema.ts`,
 * the zod discriminated union in `projectBudget.schema.ts`, and the create-project
 * dialog's labels all share exactly one source of truth — mirrors
 * `@/lib/projects/project-role-type` and `@/lib/format/currency`.
 *
 * The two models are structurally different, not two flavours of one shape: a
 * FIXED_FEE project has ONE total on the `projects` row, while a TIME_AND_MATERIALS
 * project stores no money at all — it bills hours at the company's standard rate
 * card, which lives in code (`@/lib/projects/bill-rates`). Every layer encodes that
 * split as an either/or (the `projects_budget_shape` check constraint, the zod
 * discriminated union, the create form's branch), so a half-written budget is
 * unrepresentable rather than merely invalid. See docs/domains/projects.md.
 */
export const BILLING_TYPES = ["FIXED_FEE", "TIME_AND_MATERIALS"] as const;

export type BillingType = (typeof BILLING_TYPES)[number];

/** Human-readable labels for each billing type. */
export const BILLING_TYPE_LABELS: Record<BillingType, string> = {
  FIXED_FEE: "Fixed fee",
  TIME_AND_MATERIALS: "Time & materials",
};
