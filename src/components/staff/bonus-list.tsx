import type { StaffBonusView } from "@/actions/staff/getStaffBonusHistory";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/format";
import { BONUS_TYPE_LABELS } from "@/lib/staff/staff-bonus";

/**
 * One person's bonus payments, newest first, with their year-to-date totals.
 *
 * Presentational — the read (`getStaffBonusHistory`) owns the gate and returns
 * `null` for a viewer who may not see compensation, so reaching this component at
 * all means the amounts are permitted.
 *
 * Totals are shown **per currency** rather than summed: this is a per-person view
 * and does no FX, so a single figure spanning CAD and USD would be invented.
 */
export function BonusList({ view }: { view: StaffBonusView }) {
  const { entries, ytdTotals } = view;

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No bonus payments on file.
      </p>
    );
  }

  const thisYear = new Date().getFullYear();

  return (
    <div className="flex flex-col gap-4">
      {ytdTotals.length > 0 ? (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Paid in {thisYear}
          </span>
          {ytdTotals.map(({ currency, total }) => (
            <span key={currency} className="font-medium tabular-nums">
              {formatMoney(total, currency)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {entries.map((entry) => (
          <div key={entry.id} className="flex flex-col gap-1 border-l-2 pl-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                {formatDate(entry.paymentDate)}
              </span>
              <Badge variant="secondary">{BONUS_TYPE_LABELS[entry.type]}</Badge>
              <span className="text-sm font-medium tabular-nums">
                {formatMoney(entry.amount, entry.currency)}
              </span>
            </div>
            {entry.notes ? (
              <span className="text-sm text-muted-foreground whitespace-pre-wrap">
                {entry.notes}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
