import type { ReactNode } from "react";
import type { CoverageSummary } from "@/lib/utilization/utilization-report";

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
 * The standing caveat on every confirmed number: how much of the period is
 * actually backed by a submitted timesheet, and — for viewers without
 * `timesheets.edit` — that the cohort-wide confirmed figures are withheld rather
 * than zero. A low confirmed number and an unsubmitted one look identical without
 * this line, so it renders whenever the report does.
 */
export function CoverageNote({ coverage }: { coverage: CoverageSummary }) {
  const { weeksSubmitted, weeksTotal, hasFullAccess } = coverage;
  const percent =
    weeksTotal === 0 ? 0 : Math.round((weeksSubmitted / weeksTotal) * 100);

  return (
    <div className="rounded border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      {hasFullAccess ? (
        <p>
          <span className="font-medium text-foreground">
            {weeksSubmitted} of {weeksTotal}
          </span>{" "}
          person-weeks in this period have a submitted timesheet ({percent}%).
          Confirmed hours count submitted timesheets only — draft and unstarted
          weeks read as zero, not as time that wasn&apos;t worked.
        </p>
      ) : (
        <p>
          Confirmed hours require timesheet access, so cohort totals are hidden
          and only your own row is shown. Planned figures are unaffected.
        </p>
      )}
    </div>
  );
}
