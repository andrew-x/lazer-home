import { IconAlertTriangle } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { InlineNotice } from "@/components/inline-notice";
import {
  formatHours,
  formatPercentDelta,
} from "@/lib/utilization/utilization-format";
import {
  type CoverageSummary,
  DEVIATION_FLOOR_HOURS,
  DEVIATION_THRESHOLD,
  deviates,
  type HoursSeries,
  hoursDeviation,
  type ReportBasis,
} from "@/lib/utilization/utilization-report";

/**
 * One titled block of the utilization report. Every card on the page is wrapped
 * in this so the seven sections share a heading rhythm and the caption that
 * explains how the numbers were derived sits in a predictable place.
 */
export function ReportSection({
  title,
  description,
  children,
  caption,
}: {
  title: string;
  description: string;
  children: ReactNode;
  /** Fine print under the block — the definitional caveats live here. */
  caption?: string;
}) {
  return (
    <section className="flex flex-col gap-3 border-t pt-6">
      <div>
        <h3 className="font-heading text-lg font-semibold tracking-tight">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
      {caption ? (
        <p className="text-xs text-muted-foreground">{caption}</p>
      ) : null}
    </section>
  );
}

/**
 * What the reader is currently looking at, and the caveat that comes with it.
 *
 * On the **logged** basis that caveat is coverage: a timesheet row is created
 * lazily, so a missing week means "not started", and without this line a low
 * logged figure is indistinguishable from an unsubmitted one. On the **planned**
 * basis it is simply which series is on screen — and, for a viewer who may not
 * read other people's timesheets, why the other one isn't available.
 */
export function BasisNote({
  basis,
  coverage,
}: {
  basis: ReportBasis;
  coverage: CoverageSummary;
}) {
  const { weeksSubmitted, weeksTotal, canViewLogged } = coverage;
  const percent =
    weeksTotal === 0 ? 0 : Math.round((weeksSubmitted / weeksTotal) * 100);

  if (basis === "logged") {
    return (
      <InlineNotice>
        <p>
          Showing <span className="font-medium text-foreground">logged</span>{" "}
          hours from submitted timesheets.{" "}
          <span className="font-medium text-foreground">
            {weeksSubmitted} of {weeksTotal}
          </span>{" "}
          person-weeks in this period have been submitted ({percent}%) — draft
          and unstarted weeks read as zero, not as time that wasn&apos;t worked,
          so some of any shortfall against plan is missing paperwork. Figures
          more than {Math.round(DEVIATION_THRESHOLD * 100)}% <em>and</em>{" "}
          {DEVIATION_FLOOR_HOURS} hours away from plan are flagged.
        </p>
      </InlineNotice>
    );
  }

  return (
    <InlineNotice>
      <p>
        Showing <span className="font-medium text-foreground">planned</span>{" "}
        hours from the allocations plan — confirmed roles only, since a
        tentative role is a forecast rather than an allocation.{" "}
        {canViewLogged
          ? "Switch the basis to Logged to compare against submitted timesheets."
          : "Logged hours require timesheet access, so the Logged basis is unavailable to you."}
      </p>
    </InlineNotice>
  );
}

/**
 * The message behind a deviation: what was logged, what was planned, and the gap.
 * Shared by the flag and the section-level notice so they can never disagree.
 */
function deviationMessage(value: HoursSeries): string {
  return `${formatHours(value.confirmed)} logged against ${formatHours(value.planned)} planned (${formatPercentDelta(hoursDeviation(value))})`;
}

/**
 * An inline marker on a logged figure that sits far enough from plan to be worth
 * a second look — see `deviates` for the two thresholds it has to clear. Renders
 * nothing on the planned basis, and nothing when the gap is unremarkable, so a
 * clean table stays clean.
 */
export function DeviationFlag({
  series,
  basis,
}: {
  series: HoursSeries;
  basis: ReportBasis;
}) {
  if (basis !== "logged" || !deviates(series)) return null;
  const message = deviationMessage(series);
  return (
    <span className="text-destructive" title={message}>
      <IconAlertTriangle
        aria-hidden
        className="ml-1 inline size-3.5 align-text-bottom"
      />
      <span className="sr-only">Deviates from plan: {message}</span>
    </span>
  );
}

/**
 * The section-level counterpart to {@link DeviationFlag}: a banner for a cohort
 * figure that has drifted from plan, phrased so the reader knows to check
 * coverage before treating it as a delivery problem.
 */
export function DeviationNotice({
  series,
  basis,
  label,
}: {
  series: HoursSeries;
  basis: ReportBasis;
  /** What deviated, e.g. "Full-time project hours". */
  label: string;
}) {
  if (basis !== "logged" || !deviates(series)) return null;
  return (
    <InlineNotice tone="destructive" icon={IconAlertTriangle}>
      <p>
        {label}: {deviationMessage(series)}. Check submitted-week coverage above
        before reading the whole gap as time that wasn&apos;t worked.
      </p>
    </InlineNotice>
  );
}
