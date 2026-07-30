"use client";

import { IconCoin, IconGift, IconUsers } from "@tabler/icons-react";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import type { BonusRecord } from "@/actions/performance/getBonusSummaryData";
import type { ExchangeRates } from "@/actions/staff/getExchangeRates";
import { FilterLabel } from "@/components/form/filters";
import {
  type DashboardFilters,
  type FilterOptions,
  matchesFilters,
} from "@/components/performance/dashboard-filters";
import { StatCard } from "@/components/performance/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { aggregateMoneyFormatters } from "@/lib/format/currency";
import { convert } from "@/lib/format/fx";
import {
  type BonusStatRow,
  computeBonusBreakdown,
} from "@/lib/performance/bonus-stats";
import {
  BONUS_TYPE_LABELS,
  BONUS_TYPES,
  BONUS_YEAR_PARAM,
} from "@/lib/staff/staff-bonus";
import { ROLE_LABELS } from "@/lib/staff/staff-enums";

/**
 * Calendar-year selector for the bonus section.
 *
 * Unlike the dimension filters — which narrow rows already in the browser — the
 * year selects which rows are READ, so it navigates rather than setting state.
 * `scroll: false` keeps the viewport where it is: the section sits well down the
 * page, and jumping to the top on every year change would lose the reader's place.
 */
function YearPicker({ years, year }: { years: number[]; year: number }) {
  const router = useRouter();
  const pathname = usePathname();

  // A year with no payments still needs to be selectable (that IS the answer for
  // it), so the current year is always offered even when it has none yet.
  const options = years.includes(year) ? years : [year, ...years];
  if (options.length < 2) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <FilterLabel>Year</FilterLabel>
      <ToggleGroup
        variant="outline"
        spacing={0}
        aria-label="Bonus year"
        value={[String(year)]}
        onValueChange={(values) => {
          const next = values[0];
          if (next) {
            router.push(`${pathname}?${BONUS_YEAR_PARAM}=${next}`, {
              scroll: false,
            });
          }
        }}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option} value={String(option)}>
            {option}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** The three axes the same payment set is broken down along. */
const AXES = [
  { key: "lineOfBusiness", heading: "Line of business" },
  { key: "role", heading: "Role" },
  { key: "type", heading: "Bonus type" },
] as const;

type AxisKey = (typeof AXES)[number]["key"];

/**
 * The **bonus payments** section of the compensation dashboard: what we paid out
 * in one calendar year, broken down by line of business, role and bonus type.
 *
 * Reads the dashboard's shared filter/currency state rather than owning its own,
 * so narrowing to one discipline narrows this section too. The year, by contrast,
 * is a server concern (each year is a separate read) and arrives as a prop —
 * see the `bonusYear` search param on the page.
 *
 * Two things worth knowing about the numbers, both said on screen because a reader
 * comparing this section to the headcount tables above will otherwise assume they
 * reconcile:
 *
 *  - Payments to people who have since LEFT are included. A March bonus to
 *    someone who left in June was still spent this year.
 *  - `GIFT` amounts are cash-EQUIVALENT values, so the total is reward spend
 *    rather than cash out the door. The by-type table separates them.
 */
export function BonusBreakdown({
  records,
  years,
  year,
  unattributed,
  rates,
  filters,
  filterOptions,
}: {
  records: BonusRecord[];
  years: number[];
  year: number;
  unattributed: number;
  rates: ExchangeRates;
  filters: DashboardFilters;
  filterOptions: FilterOptions;
}) {
  const { lineOfBusiness, role, employmentType, currency } = filters;

  // Normalize every payment to the display currency once, then aggregate along
  // each axis off the same rows — so the three tables can never disagree on a
  // total. Payments, not people: one person may appear repeatedly.
  const byAxis = useMemo(() => {
    const filtered = records.filter((r) =>
      matchesFilters(r, { lineOfBusiness, role, employmentType }),
    );

    const rowsFor = (axis: AxisKey): BonusStatRow[] =>
      filtered.map((r) => ({
        recipientKey: r.recipientKey,
        group: r[axis],
        amount: convert(r.amount, r.currency, currency, rates.rates),
      }));

    const order: Record<AxisKey, readonly string[]> = {
      lineOfBusiness: filterOptions.lineOfBusiness,
      role: filterOptions.role,
      type: BONUS_TYPES,
    };
    const labels: Record<AxisKey, Record<string, string>> = {
      lineOfBusiness: LINE_OF_BUSINESS_LABELS,
      role: ROLE_LABELS,
      type: BONUS_TYPE_LABELS,
    };

    return AXES.map((axis) => ({
      ...axis,
      labels: labels[axis.key],
      ...computeBonusBreakdown(rowsFor(axis.key), order[axis.key]),
    }));
  }, [
    records,
    rates,
    filterOptions.lineOfBusiness,
    filterOptions.role,
    lineOfBusiness,
    role,
    employmentType,
    currency,
  ]);

  // Every axis aggregates the same rows, so any one of them carries the totals.
  const overall = byAxis[0].overall;
  const { money } = aggregateMoneyFormatters(currency);

  return (
    <div className="flex flex-col gap-4">
      <YearPicker years={years} year={year} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total paid"
          value={money(overall.total)}
          hint={`${year} · includes non-cash gifts at equivalent value`}
          icon={IconCoin}
        />
        <StatCard
          label="Payments"
          value={String(overall.payments)}
          hint="Individual bonus payments"
          icon={IconGift}
        />
        <StatCard
          label="Recipients"
          value={String(overall.recipients)}
          hint="People paid at least one bonus"
          icon={IconUsers}
        />
      </div>

      {unattributed > 0 ? (
        <p className="text-sm text-muted-foreground">
          {unattributed === 1
            ? "1 payment is excluded below"
            : `${unattributed} payments are excluded below`}{" "}
          — the recipient has no employment record, so there is no line of
          business or role to count them under.
        </p>
      ) : null}

      {overall.payments === 0 ? (
        <p className="text-sm text-muted-foreground">
          No bonus payments in {year} match the selected filters.
        </p>
      ) : (
        byAxis.map(({ key, heading, labels, groups, overall: axis }) => (
          <div key={key} className="rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{heading}</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Recipients</TableHead>
                  <TableHead className="text-right">Avg / recipient</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map(({ group, stats }) => (
                  <TableRow key={group}>
                    <TableCell className="font-medium">
                      {labels[group] ?? group}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(stats.total)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {stats.payments}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {stats.recipients}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(stats.avgPerRecipient)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>All</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(axis.total)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {axis.payments}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {axis.recipients}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(axis.avgPerRecipient)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        ))
      )}

      <p className="text-xs text-muted-foreground">
        Bonus totals count everyone paid during {year}, including people who
        have since left — so they don't reconcile per-head with the headcount
        above.
        {years.length > 1
          ? " Use the year selector to compare against another year."
          : ""}
      </p>
    </div>
  );
}
