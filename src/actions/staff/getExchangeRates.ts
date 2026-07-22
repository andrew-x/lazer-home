import "server-only";

import { z } from "zod";
import { logger } from "@/lib/core/logger";
import { CURRENCY, type Currency } from "@/lib/format/currency";
import { AED_PER_USD, FALLBACK_USD_RATES } from "@/lib/format/fx";

/**
 * USD-based exchange rates for the compensation dashboard's currency toggle.
 * `rates` is 1 USD → currency for every supported {@link Currency}; `asOf` is the
 * rate date; `stale` is true when we fell back to hardcoded rates (the live fetch
 * failed) so the UI can flag it.
 */
export type ExchangeRates = {
  rates: Record<Currency, number>;
  asOf: string;
  stale: boolean;
};

/**
 * Runtime schema for the frankfurter.dev `/latest` response — the one external
 * payload we validate at the trust boundary (all other network data already flows
 * through Zod). `date` must be a real `YYYY-MM-DD` calendar date and every quoted
 * `rate` a finite, POSITIVE number; a malformed body fails `safeParse` and drops us
 * onto the stale fallback rather than poisoning the conversion table.
 */
const frankfurterResponseSchema = z.object({
  date: z.string().refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    // Reject non-existent dates (e.g. 2024-02-30, which Date would roll forward).
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "expected a real YYYY-MM-DD date"),
  rates: z.record(
    z.string(),
    z.number().refine(Number.isFinite, "must be finite").positive(),
  ),
});

const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest?base=USD";

// Rates move at most once per business day; cache for 12h so the dashboard isn't
// hitting the API on every request. (Next `fetch` revalidation — see
// node_modules/next/dist/docs/.../fetch.md; `unstable_cache` is superseded here.)
const REVALIDATE_SECONDS = 60 * 60 * 12;

/**
 * Fetch live USD-based exchange rates from frankfurter.dev, splicing in the
 * currencies it doesn't quote: USD itself (1) and the USD-pegged AED. Never
 * throws — on any network/parse failure it returns {@link FALLBACK_USD_RATES}
 * with `stale: true` so the dashboard still renders.
 */
export async function getExchangeRates(): Promise<ExchangeRates> {
  try {
    const res = await fetch(FRANKFURTER_URL, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) throw new Error(`frankfurter responded ${res.status}`);

    // Validate the untrusted body before trusting any field. A parse failure
    // throws into the catch below, joining the same stale/fallback path as a
    // network error — never surfaced to the user.
    const parsed = frankfurterResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new Error(
        `frankfurter response failed validation: ${parsed.error.message}`,
      );
    }
    const data = parsed.data;
    // frankfurter omits the base currency from `rates`; add USD, and the pegged
    // AED it never quotes.
    const raw: Record<string, number> = {
      ...data.rates,
      USD: 1,
      AED: AED_PER_USD,
    };

    // Keep only the currencies we support, and bail to the fallback if any is
    // missing rather than shipping a partial table that would break conversion.
    const rates = {} as Record<Currency, number>;
    for (const code of CURRENCY) {
      const rate = raw[code];
      if (typeof rate !== "number" || !Number.isFinite(rate)) {
        throw new Error(`frankfurter missing rate for ${code}`);
      }
      rates[code] = rate;
    }

    return { rates, asOf: data.date, stale: false };
  } catch (error) {
    logger.warn("exchange_rates_fallback", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { rates: FALLBACK_USD_RATES, asOf: "unavailable", stale: true };
  }
}
