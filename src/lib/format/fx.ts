/**
 * Foreign-exchange conversion for compensation analytics. Pure and
 * client-importable (no `db`/drizzle) so the server read, the dashboard, and its
 * tests all share one conversion helper.
 *
 * Rates are carried USD-based (1 USD → currency) — the shape frankfurter.dev
 * returns for `?base=USD` — so any pair converts via a USD cross-rate.
 */
import type { Currency } from "@/lib/format/currency";

/**
 * The UAE dirham is pegged to the US dollar (1 USD = 3.6725 AED, fixed since
 * 1997). frankfurter.dev quotes 30 currencies but NOT AED, so we carry the peg
 * ourselves and splice it into the live rate table.
 */
export const AED_PER_USD = 3.6725;

/**
 * USD-based rates (1 USD → currency) used ONLY when the live frankfurter.dev
 * fetch fails, so the dashboard still renders. Approximate — the accompanying
 * `stale` flag tells the UI these are in use.
 */
export const FALLBACK_USD_RATES: Record<Currency, number> = {
  USD: 1,
  CAD: 1.37,
  GBP: 0.79,
  EUR: 0.92,
  AED: AED_PER_USD,
};

/**
 * Convert `amount` from one currency to another given a USD-based rate table
 * (1 USD → X). Cross-rate through USD: `from` → USD (÷ rate[from]) → `to`
 * (× rate[to]). Identical currencies short-circuit to avoid float drift.
 */
export function convert(
  amount: number,
  from: Currency,
  to: Currency,
  usdRates: Record<Currency, number>,
): number {
  if (from === to) return amount;
  return (amount / usdRates[from]) * usdRates[to];
}
