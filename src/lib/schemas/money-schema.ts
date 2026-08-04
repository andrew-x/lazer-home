import { z } from "zod";

/**
 * The largest value a `numeric(12, 2)` column holds — the shape every money column
 * in this schema uses. Shared so the literal lives in one place rather than being
 * re-typed beside each amount field.
 */
export const MAX_MONEY = 9_999_999_999.99;

/**
 * A money amount that a blank form field means "absent" for, rather than zero.
 *
 * Two things make this necessary rather than decorative. `z.coerce.number()` turns the
 * empty string a blank input submits into `0`, and `.positive()` then *rejects* it — so
 * a plainly optional amount would report a validation error instead of coming through
 * as `undefined`. The `preprocess` maps blank/null to `undefined` first so `.optional()`
 * can short-circuit ahead of coercion.
 *
 * This is the **mirror image** of `projectBudget.schema.ts`'s fixed-fee amount, where
 * `.positive()` is load-bearing precisely so a blank field *fails* rather than saving a
 * $0 budget. Same coercion, opposite intent — which is why the distinction is a named
 * primitive instead of an inline chain that reads like a copy-paste slip.
 *
 * Use where an absent amount has a real meaning the caller then supplies (e.g. a bill
 * rate that falls back to the rate card), never where absence should be an error.
 */
export const optionalMoney = (messages: { positive: string; max: string }) =>
  z.preprocess((value) => {
    // Trim first: a whitespace-only string would otherwise coerce to 0 and fail
    // `.positive()`, reporting "enter a rate greater than 0" for a field that is, to
    // any reader, simply blank. A `type="number"` input can't produce one, but this
    // primitive is shared and shouldn't depend on that.
    const trimmed = typeof value === "string" ? value.trim() : value;
    return trimmed === "" || trimmed == null ? undefined : trimmed;
  }, z.coerce
    .number()
    .positive(messages.positive)
    .max(MAX_MONEY, messages.max)
    .optional());
