/**
 * The supported compensation currencies. Declared here as a pure, client-importable
 * module (no `db`/drizzle) so the `currencyEnum` pgEnum in `staff-schema.ts`, zod
 * schemas, and client display all share exactly one source of truth — mirroring
 * `@/lib/line-of-business`.
 */
export const CURRENCY = ["CAD", "USD", "GBP", "EUR"] as const;

export type Currency = (typeof CURRENCY)[number];

/** Human-readable labels for each currency. */
export const CURRENCY_LABELS: Record<Currency, string> = {
  CAD: "Canadian dollar",
  USD: "US dollar",
  GBP: "British pound",
  EUR: "Euro",
};

/** Format a money amount for display, e.g. `formatMoney(150000, "CAD")` → "CA$150,000.00". */
export function formatMoney(amount: number, currency: Currency): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amount);
}

/**
 * Normalize a raw CSV cell to a known currency code; unrecognized/blank → null.
 * Never throws — compensation is optional/supplementary, so a bad cell just yields
 * no currency rather than failing the whole row.
 */
export function normalizeCurrency(raw: string): Currency | null {
  const code = raw.trim().toUpperCase();
  return (CURRENCY as readonly string[]).includes(code)
    ? (code as Currency)
    : null;
}
