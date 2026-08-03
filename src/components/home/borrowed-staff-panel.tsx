import { IconArrowRight } from "@tabler/icons-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PersonRow } from "@/components/home/person-row";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { formatShortDate, parseIsoDate } from "@/lib/format/format";
import type { OrgBorrowed } from "@/lib/home/org-status";

/** Rows shown before the list defers to a summary line. */
const ROW_LIMIT = 5;

/**
 * Who is working outside their own line of business right now.
 *
 * Lending is normal and often good — it's how a busy practice gets covered. What
 * this panel makes visible is *how much* of it is happening and *to whom*, which is
 * otherwise invisible: the planner shows allocations, but nothing there compares a
 * person's home line of business to the work's.
 *
 * The row reads as a movement — person, arrow, destination — because that is the
 * fact: someone's capacity is being spent somewhere other than where it's counted.
 * The end date is included because the first question is always "until when".
 *
 * Confirmed roles only, and only spans covering today, consistently with the
 * staffing panel: a tentative cross-line booking hasn't lent anyone anywhere yet.
 *
 * Related: `/dashboards/utilization` measures the same drift as a day-weighted
 * aggregate over a range (`buildLobAlignment`). This is the named-people view of
 * today. Keep both — "how much drift" and "who, right now" are different questions.
 */
export function BorrowedStaffPanel({ rows }: { rows: OrgBorrowed[] }) {
  const shown = rows.slice(0, ROW_LIMIT);
  const remaining = rows.length - shown.length;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Borrowed staff</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {shown.length === 0 ? (
          <EmptyState>
            Everyone is working inside their own line of business.
          </EmptyState>
        ) : (
          shown.map((row) => (
            <PersonRow
              key={`${row.staffId}-${row.projectId}`}
              staffId={row.staffId}
              name={row.name}
              staffRole={null}
              lineOfBusiness={null}
              subtitle={
                <span className="flex items-center gap-1">
                  {LINE_OF_BUSINESS_LABELS[row.homeLineOfBusiness]}
                  <IconArrowRight className="size-3 shrink-0" />
                  <Link
                    href={`/projects/${row.projectId}`}
                    className="truncate hover:underline"
                  >
                    {row.projectName} ·{" "}
                    {LINE_OF_BUSINESS_LABELS[row.roleLineOfBusiness]}
                  </Link>
                </span>
              }
              trailing={`to ${formatShortDate(parseIsoDate(row.endDate))}`}
            />
          ))
        )}
        {remaining > 0 ? (
          <p className="pt-1 text-xs text-muted-foreground">
            {remaining} more working outside their line of business
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
