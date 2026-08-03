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
import type { RoleStaffing, StaffingSummary } from "@/lib/home/org-status";
import { ROLE_LABELS } from "@/lib/staff/staff-enums";

const ROLE_ROW_LABELS: Record<RoleStaffing["role"], string> = {
  ...ROLE_LABELS,
  OTHER: "Other",
};

/**
 * How much of the bench is working, **right now**.
 *
 * This replaced a year-to-date, timesheet-driven table. Three deliberate changes:
 *
 * - **Point in time, not cumulative.** The header states the date rather than a
 *   range, because that is what the figures describe. Sitting opposite Your
 *   Status's year-to-date tiles, an unlabelled "Utilization" here would be read as
 *   the same kind of number; it isn't, so the word never appears alone.
 * - **From the plan, not from timesheets.** Counting confirmed allocations answers
 *   "are people on work"; counting submitted hours answers "did people log time",
 *   and with partial timesheet coverage the second masquerades as the first.
 * - **No target column.** A target belongs next to a cumulative figure you could
 *   still act to hit, not next to a snapshot of today.
 *
 * A **table, not tiles**, for the by-role breakdown: five disciplines × three
 * figures is unreadable as tiles, and putting staffed beside headcount is the
 * whole point — the gap is the bench.
 *
 * Rows are the **delivery disciplines** only. Overhead roles aren't staffed onto
 * client work, so their rows were permanently empty noise; anyone in the billable
 * population who isn't in a delivery discipline falls into `Other`, which appears
 * only when non-empty. That keeps the rows accounting for exactly the same people as
 * the Overall row.
 */
export function StaffingPanel({
  summary,
  today,
}: {
  summary: StaffingSummary;
  today: string;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Staffing</CardTitle>
        <CardAction className="text-sm text-muted-foreground">
          As of {formatShortDate(parseIsoDate(today))}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {summary.headcount === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active billable staff to report on.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <Figure
                label="Staffed now"
                value={String(summary.staffed)}
                hint="On a confirmed role today"
              />
              <Figure
                label="Headcount"
                value={String(summary.headcount)}
                hint="Active billable staff"
              />
              <Figure
                label="Staffed rate"
                value={formatPercent(summary.rate)}
                hint="Staffed ÷ headcount"
              />
              <Figure
                label="Normalized"
                value={formatPercent(summary.normalizedRate)}
                hint={`Staffed ÷ ${summary.fullTimeCount} full time`}
              />
            </div>

            <div className="overflow-x-auto">
              <Table className={ROOMY_TABLE}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Staffed</TableHead>
                    <TableHead className="text-right">Headcount</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.byRole.map((row) => (
                    <StaffingRow key={row.role} row={row} />
                  ))}
                  <StaffingRow
                    row={{
                      role: "OTHER",
                      staffed: summary.staffed,
                      headcount: summary.headcount,
                      rate: summary.rate,
                    }}
                    label="Overall"
                    emphasize
                  />
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-muted-foreground">
              Counts people on a confirmed allocation today — tentative work
              doesn&apos;t commit anyone, and approved leave doesn&apos;t
              un-staff them. <strong>Normalized</strong> divides by full-time
              headcount, so it can exceed 100% when hourly staff are on work.
              From the staffing plan, not timesheets.
            </p>
          </>
        )}
      </CardContent>
    </Card>
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

/** An empty discipline shows "—": 0% of nobody is a lie, not a zero. */
function StaffingRow({
  row,
  label,
  emphasize = false,
}: {
  row: RoleStaffing;
  label?: string;
  emphasize?: boolean;
}) {
  const empty = row.headcount === 0;

  return (
    <TableRow className={cn(emphasize && "border-t-2 font-medium")}>
      <TableCell>{label ?? ROLE_ROW_LABELS[row.role]}</TableCell>
      <TableCell className="text-right tabular-nums">
        {empty ? "—" : row.staffed}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {empty ? "—" : row.headcount}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {empty ? "—" : formatPercent(row.rate)}
      </TableCell>
    </TableRow>
  );
}
