import type { ExchangeRates } from "@/actions/staff/getExchangeRates";
import { FxRateNote } from "@/components/fx-rate-note";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  aggregateMoneyFormatters,
  type Currency,
  type DisplayCurrency,
} from "@/lib/format/currency";
import {
  formatDateRange,
  formatShortDate,
  parseIsoDate,
} from "@/lib/format/format";
import type {
  BandValue,
  FunnelBandSummary,
  PipelineSummary,
} from "@/lib/home/pipeline";

/**
 * What's coming in — the sales pipeline, company-wide.
 *
 * Sits directly under Staffing because the two answer adjacent questions: Staffing
 * says whether the bench is working, this says whether there's work coming to keep
 * it working. Without it, a staffed bench with an empty pipeline and an idle bench
 * with a full one look identical on this page.
 *
 * ## Two time bases in one card, both named
 *
 * The bands are **point in time** — deals open right now — which is what the
 * `As of <date>` header states. The closed counts are **windowed**, and they're the
 * one windowed figure in an otherwise point-in-time band, so they sit in their own
 * sub-row with their windows spelled out as **dates rather than words**. That's not
 * decoration: with a Monday-start week, "this week" can begin in the previous month,
 * so the week figure is *not* a subset of the month's, and "this week / this month"
 * alone would imply that it is.
 *
 * ## No `"use client"`, deliberately
 *
 * Rendered by `LazerStatusSection`, which is already a Client Component, so this is
 * client-compiled either way — the same relationship `ProjectRolesPanel` and
 * `BorrowedStaffPanel` have, and none of them carries the directive. It holds **no
 * state**: the line-of-business filter lives one level up and hands down an
 * already-selected summary. Don't add `useState` here.
 *
 * Apostrophes are written literally (`doesn't`, not `&apos;`) — this file is
 * client-compiled, so an entity in a multi-line JSX text run causes a hydration
 * mismatch. See the standing note in `staffing-panel.tsx`.
 */
export function PipelinePanel({
  summary,
  displayCurrency,
  convertedFrom,
  rates,
  today,
  weekStart,
  monthStart,
}: {
  summary: PipelineSummary;
  displayCurrency: DisplayCurrency;
  convertedFrom: readonly Currency[];
  rates: ExchangeRates;
  today: string;
  weekStart: string;
  monthStart: string;
}) {
  const { money } = aggregateMoneyFormatters(displayCurrency);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Pipeline</CardTitle>
        <CardAction className="text-sm text-muted-foreground">
          Open now · {formatShortDate(parseIsoDate(today))}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {summary.openDeals === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open deals in the funnel right now.
          </p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-3">
            {summary.bands.map((band) => (
              <BandBlock key={band.id} band={band} money={money} />
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t pt-4">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Closed deals
          </span>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Figure
              label="Won this week"
              value={String(summary.closed.week.won)}
              hint={`Closed ${formatDateRange(weekStart, today)}`}
            />
            <Figure
              label="Lost this week"
              value={String(summary.closed.week.lost)}
              hint={`Closed ${formatDateRange(weekStart, today)}`}
            />
            <Figure
              label="Won this month"
              value={String(summary.closed.month.won)}
              hint={`Closed since ${formatShortDate(parseIsoDate(monthStart))}`}
            />
            <Figure
              label="Lost this month"
              value={String(summary.closed.month.lost)}
              hint={`Closed since ${formatShortDate(parseIsoDate(monthStart))}`}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">
            Counts are open deals right now, and exclude{" "}
            <strong>Maturing</strong> — a holding pen the funnel doesn't
            forecast from, so these won't sum to the board's open cards. Value
            is each linked project's plan revenue in {displayCurrency}, counted{" "}
            <strong>once per project</strong>: several deals can share one
            project, and a deal with no priced plan is counted as unpriced
            rather than as zero.
          </p>
          <FxRateNote rates={rates} from={convertedFrom} to={displayCurrency} />
        </div>
      </CardContent>
    </Card>
  );
}

/** One funnel band: its deal count, its stage breakdown, and its money if it has any. */
function BandBlock({
  band,
  money,
}: {
  band: FunnelBandSummary;
  money: (value: number | null) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Figure
        label={band.label}
        value={String(band.deals)}
        hint={band.deals === 1 ? "open deal" : "open deals"}
      />
      <ul className="flex flex-col gap-0.5 text-xs">
        {band.stages.map((stage) => (
          <li
            key={stage.status}
            className="flex items-baseline justify-between gap-2"
          >
            <span className="text-muted-foreground">{stage.label}</span>
            <span className="tabular-nums">{stage.count}</span>
          </li>
        ))}
      </ul>
      {band.value && <BandMoney value={band.value} money={money} />}
    </div>
  );
}

function BandMoney({
  value,
  money,
}: {
  value: BandValue;
  money: (value: number | null) => string;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-t pt-2 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground">Plan value</span>
        <span className="font-medium tabular-nums">{money(value.total)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground">Fixed fee</span>
        <span className="tabular-nums">{money(value.fixedFee)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        {/* Literal `&`, not `&amp;` — this file is client-compiled. */}
        <span className="text-muted-foreground">Time & materials</span>
        <span className="tabular-nums">{money(value.timeAndMaterials)}</span>
      </div>
      <p className="pt-1 text-muted-foreground">
        {value.pricedProjects === 1
          ? "1 project priced"
          : `${value.pricedProjects} projects priced`}
        {value.unpricedDeals > 0 && ` · ${value.unpricedDeals} unpriced`}
      </p>
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}
