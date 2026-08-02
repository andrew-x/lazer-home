import { ROOMY_TABLE } from "@/components/table-density";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/core/utils";
import {
  formatPercent,
  formatShortDate,
  parseIsoDate,
} from "@/lib/format/format";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/staff/staff-enums";
import {
  MIN_COHORT_SIZE,
  type UtilizationGroup,
} from "@/lib/timesheets/utilization";

const GROUP_LABELS: Record<UtilizationGroup["key"], string> = {
  ...EMPLOYMENT_TYPE_LABELS,
  UNKNOWN: "Unrecorded",
  OVERALL: "Overall",
};

/**
 * Organization utilization year to date: planned against actual, split by
 * employment type.
 *
 * A **table, not tiles** — twelve numbers across cohort × actual/planned/target/
 * headcount would be unreadable as twelve stat cards, and putting the two rate
 * columns adjacent is the whole point: the gap between them is the signal.
 *
 * Two disclosures are mandatory here, not decorative. The **date range** is in the
 * header, because "utilization" with no period attached invites being read as a
 * full-year verdict in February. The **coverage** line is in the footer, because
 * the actual column describes people who logged time, not the company — and the
 * two columns' denominators are not the same kind of thing (see
 * `@/lib/timesheets/utilization`).
 */
export function UtilizationPanel({
  rangeStart,
  rangeEnd,
  overall,
  groups,
  headcount,
  logged,
  nonBillableExcluded,
}: {
  rangeStart: string;
  rangeEnd: string;
  overall: UtilizationGroup;
  groups: UtilizationGroup[];
  headcount: number;
  logged: number;
  nonBillableExcluded: number;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Utilization</CardTitle>
        <CardAction className="text-sm text-muted-foreground">
          {formatShortDate(parseIsoDate(rangeStart))} –{" "}
          {formatShortDate(parseIsoDate(rangeEnd))}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {headcount === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active billable staff to report on yet.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className={ROOMY_TABLE}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cohort</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Planned</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">People</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((group) => (
                    <UtilizationRow key={group.key} group={group} />
                  ))}
                  <UtilizationRow group={overall} emphasize />
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              {logged} of {headcount} billable staff have logged time this year.
              Actual is measured against hours recorded; planned against
              calendar capacity net of approved leave, both to date.
              {nonBillableExcluded > 0
                ? ` Excludes ${nonBillableExcluded} non-billable staff.`
                : ""}
              {groups.some((group) => group.suppressed)
                ? ` Cohorts under ${MIN_COHORT_SIZE} people show headcount only.`
                : ""}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** An empty cohort shows "—" everywhere: 0.0% for nobody is a lie, not a zero. */
function UtilizationRow({
  group,
  emphasize = false,
}: {
  group: UtilizationGroup;
  emphasize?: boolean;
}) {
  const empty = group.headcount === 0;
  const figure = (value: string) => (empty ? "—" : value);

  return (
    <TableRow className={cn(emphasize && "border-t-2 font-medium")}>
      <TableCell>{GROUP_LABELS[group.key]}</TableCell>
      <TableCell className="text-right tabular-nums">
        {figure(formatPercent(group.summary.actual.rate))}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {figure(formatPercent(group.summary.planned.rate))}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {figure(formatPercent(group.weightedTarget))}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {group.headcount}
      </TableCell>
    </TableRow>
  );
}
