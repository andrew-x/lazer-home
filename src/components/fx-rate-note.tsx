"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import type { ExchangeRates } from "@/actions/staff/getExchangeRates";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type Currency, formatAmount } from "@/lib/format/currency";
import { convert } from "@/lib/format/fx";

/**
 * The exchange rates a panel's figures were converted at, stated once beside the
 * currency selector that caused the conversion.
 *
 * Deliberately not an icon on each converted value: the caveat belongs to the whole
 * set of figures, per-figure markers turn into noise the moment more than one value
 * is converted, and — the real problem — "this was converted" is only half the
 * information. What a reader needs is the rate, and how fresh it is (rates come from a
 * 12-hour-cached external fetch; see ADR 0029).
 *
 * Renders nothing when no conversion happened, so a single-currency project stays
 * uncluttered.
 */
export function FxRateNote({
  rates,
  from,
  to,
}: {
  rates: ExchangeRates;
  /** The currencies a rate was actually applied to — `ProjectMargin.convertedFrom`. */
  from: readonly Currency[];
  to: Currency;
}) {
  if (from.length === 0) return null;

  const pairs = from.map((code) => ({
    code,
    label: `1 ${code} = ${formatRate(convert(1, code, to, rates.rates))} ${to}`,
  }));

  // One pair reads fine inline; several would crowd the header, so the summary goes
  // inline and the individual rates move into the tooltip.
  const inline =
    pairs.length === 1 ? pairs[0].label : "Converted at today's rates";

  const freshness = rates.stale
    ? "Live exchange rates are unavailable, so these are approximate fallback rates."
    : `Rates as of ${rates.asOf}.`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            <IconAlertTriangle className="size-3.5 shrink-0" />
            {inline}
          </span>
        }
      />
      <TooltipContent className="flex-col items-start gap-0.5">
        <span>
          Some figures were converted into {to} at{" "}
          {rates.stale ? "approximate" : "today's"} rates:
        </span>
        {pairs.map((pair) => (
          <span key={pair.code} className="tabular-nums">
            {pair.label}
          </span>
        ))}
        <span className="text-background/70">{freshness}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A rate at 4 significant-ish decimals, trailing zeros dropped — "1.37", not
 * "1.3700". Enough precision to reproduce a converted figure by hand without
 * implying more accuracy than a daily rate has.
 */
function formatRate(rate: number): string {
  return formatAmount(rate, { maximumFractionDigits: 4 });
}
