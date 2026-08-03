/**
 * The supported compensation currencies. Declared here as a pure, client-importable
 * module (no `db`/drizzle) so the `currencyEnum` pgEnum in `staff-schema.ts`, zod
 * schemas, and client display all share exactly one source of truth — mirroring
 * `@/lib/crm/line-of-business`.
 */
export const CURRENCY = ["CAD", "USD", "GBP", "EUR", "AED"] as const;

export type Currency = (typeof CURRENCY)[number];

/**
 * Labels for a currency select. An identity map — the ISO code *is* the label —
 * but `EnumSelect` requires a `labels` record, and spelling it out here keeps
 * every currency picker in the app reading from one place.
 */
export const CURRENCY_LABELS: Record<Currency, string> = {
  CAD: "CAD",
  USD: "USD",
  GBP: "GBP",
  EUR: "EUR",
  AED: "AED",
};

/**
 * The currencies a figure may be *displayed* in. Narrower than {@link CURRENCY}
 * on purpose: amounts are stored in whatever currency they were agreed in, but
 * the reporting surfaces (the compensation dashboards, a project's budget summary)
 * normalize everything to one of the two we report in, so a two-way toggle stays
 * a toggle rather than a five-way select.
 */
export const DISPLAY_CURRENCIES = [
  "CAD",
  "USD",
] as const satisfies readonly Currency[];

export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

/**
 * Format a money amount for display, e.g. `formatMoney(150000, "CAD")` →
 * "CA$150,000.00". Pass Intl options to override the defaults — e.g.
 * `formatMoney(150000, "CAD", { maximumFractionDigits: 0 })` → "CA$150,000" for
 * compact aggregate figures.
 */
export function formatMoney(
  amount: number,
  currency: Currency,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    ...options,
  }).format(amount);
}

/**
 * Format a bare money amount with no currency, e.g. `formatAmount(150000)` →
 * "150,000" — the fallback for a comp value whose currency is unknown. Same
 * grouping/locale as `formatMoney`, just without the currency symbol; pass Intl
 * options to override the defaults.
 */
export function formatAmount(
  amount: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(undefined, options).format(amount);
}

/**
 * Money formatters for aggregate figures in a chosen display currency: whole
 * dollars (no cents), and an em dash for the `null` an empty group yields — so a
 * KPI card or table cell reads "—" rather than "NaN". Shared by the dashboards
 * that normalize every amount to one display currency before aggregating.
 */
export function aggregateMoneyFormatters(currency: Currency) {
  const money = (value: number | null) =>
    value == null
      ? "—"
      : formatMoney(value, currency, {
          maximumFractionDigits: 0,
          minimumFractionDigits: 0,
        });

  const range = (min: number | null, max: number | null) =>
    min == null || max == null ? "—" : `${money(min)} – ${money(max)}`;

  return { money, range };
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
