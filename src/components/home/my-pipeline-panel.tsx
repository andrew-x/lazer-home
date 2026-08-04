import type { MyDealView, MyPipelineView } from "@/actions/crm/getMyPipeline";
import { EmptyState } from "@/components/empty-state";
import { FxRateNote } from "@/components/fx-rate-note";
import { ScrollList } from "@/components/home/scroll-list";
import {
  aggregateMoneyFormatters,
  type DisplayCurrency,
} from "@/lib/format/currency";
import {
  formatDateRange,
  formatShortDate,
  parseIsoDate,
} from "@/lib/format/format";
import { BILLING_TYPE_LABELS } from "@/lib/projects/project-billing";

/**
 * The deals **you own**, by stage — your half of the pipeline, beside your tasks.
 *
 * ## A true Server Component
 *
 * Unlike `MyTasksPanel` directly above it, this carries no `"use client"` and needs
 * none: nothing here searches, filters or ticks anything off. So its per-deal money
 * never leaves the server, and the route's client payload doesn't grow. Don't
 * "match the pattern" of the panel above by adding the directive — the read's
 * `MyDealView` whitelist is written as though you might, but the point is that
 * today nothing crosses.
 *
 * ## Two windows, both named
 *
 * The stage list is point in time; the closed counts are windowed, stated as dates
 * because a Monday-start week can begin in the previous month — so the week figure
 * is not a subset of the month's. Your Status already mixes windows per block
 * (ADR 0065), and this follows that: the caption names this block's own window
 * rather than relying on the band's.
 *
 * ## "Project plan value", not "deal value"
 *
 * Each figure is the *linked project's whole* plan revenue, matching what that
 * deal's plan drawer shows. Two of your deals on one project therefore each report
 * that project's value, while the company-wide band counts it once. The label is
 * what keeps those two honest — don't shorten it to "value" or "deal size".
 */
export function MyPipelinePanel({ pipeline }: { pipeline: MyPipelineView }) {
  const { money } = aggregateMoneyFormatters(pipeline.displayCurrency);
  const dealCount = pipeline.stages.reduce(
    (sum, stage) => sum + stage.deals.length,
    0,
  );

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="font-heading text-base font-semibold tracking-tight">
          Pipeline
        </h3>
        <p className="text-sm text-muted-foreground">
          Deals you own — open right now.{" "}
          {dealCount > 0
            ? `${dealCount} in the funnel.`
            : "Nothing in the funnel."}{" "}
          Excludes Maturing.
        </p>
      </div>

      {pipeline.stages.length === 0 ? (
        <EmptyState bordered>
          You do not own any open deals. Deals you are named an owner of on{" "}
          <strong>Opportunities</strong> show up here.
        </EmptyState>
      ) : (
        <ScrollList className="rounded-md border p-3">
          {pipeline.stages.map((stage) => (
            <div key={stage.status} className="flex flex-col gap-1 py-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {stage.label}
                  <span className="ml-1.5 tabular-nums">
                    {stage.deals.length}
                  </span>
                </span>
                <span className="text-xs tabular-nums">
                  {money(stage.value)}
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {stage.deals.map((deal) => (
                  <DealRow
                    key={deal.opportunityId}
                    deal={deal}
                    money={money}
                    displayCurrency={pipeline.displayCurrency}
                  />
                ))}
              </ul>
            </div>
          ))}
        </ScrollList>
      )}

      <div className="flex flex-col gap-3 border-t pt-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Your closed deals
        </span>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Figure
            label="Won this week"
            value={String(pipeline.closed.week.won)}
            hint={`Closed ${formatDateRange(pipeline.weekStart, pipeline.today)}`}
          />
          <Figure
            label="Lost this week"
            value={String(pipeline.closed.week.lost)}
            hint={`Closed ${formatDateRange(pipeline.weekStart, pipeline.today)}`}
          />
          <Figure
            label="Won this month"
            value={String(pipeline.closed.month.won)}
            hint={`Closed since ${formatShortDate(parseIsoDate(pipeline.monthStart))}`}
          />
          <Figure
            label="Lost this month"
            value={String(pipeline.closed.month.lost)}
            hint={`Closed since ${formatShortDate(parseIsoDate(pipeline.monthStart))}`}
          />
        </div>
        <FxRateNote
          rates={pipeline.rates}
          from={pipeline.convertedFrom}
          to={pipeline.displayCurrency}
        />
      </div>
    </section>
  );
}

/** One deal: who it's for, what its plan is worth, and what happens next. */
function DealRow({
  deal,
  money,
  displayCurrency,
}: {
  deal: MyDealView;
  money: (value: number | null) => string;
  displayCurrency: DisplayCurrency;
}) {
  return (
    <li className="flex flex-col gap-0.5 rounded-sm px-2 py-1.5 hover:bg-muted/50">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{deal.name}</span>
        <span
          className="shrink-0 text-sm tabular-nums"
          title={
            deal.value === null
              ? "No priceable plan on the linked project yet"
              : `Project plan value in ${displayCurrency}`
          }
        >
          {money(deal.value)}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">
        {deal.companyName}
        {deal.billingType && ` · ${BILLING_TYPE_LABELS[deal.billingType]}`}
      </span>
      {deal.nextSteps.length === 0 ? (
        <span className="text-xs text-muted-foreground italic">
          No next steps
        </span>
      ) : (
        <ul className="flex flex-col gap-0.5 pt-0.5">
          {deal.nextSteps.map((step) => (
            <li key={step.id} className="text-xs text-muted-foreground">
              → {step.description}
            </li>
          ))}
        </ul>
      )}
    </li>
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
