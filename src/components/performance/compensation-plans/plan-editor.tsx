"use client";

import { IconUsers } from "@tabler/icons-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { CompensationPlanDetail } from "@/actions/performance/getCompensationPlan";
import type { ExchangeRates } from "@/actions/staff/getExchangeRates";
import { EmptyState } from "@/components/empty-state";
import { FilterLabel } from "@/components/form/filters";
import {
  aggregateSaveState,
  SaveIndicator,
} from "@/components/form/save-indicator";
import { SortHeaderButton } from "@/components/form/sort-header";
import { StaffProfileDrawer } from "@/components/staff/staff-profile-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/core/utils";
import { aggregateMoneyFormatters } from "@/lib/format/currency";
import { formatTimestamp } from "@/lib/format/format";
import {
  COMPENSATION_PLAN_STATUS_LABELS,
  DISPLAY_CURRENCY_LABELS,
  DISPLAY_CURRENCY_MODES,
  type DisplayCurrencyMode,
  PLAN_SUMMARY_CURRENCY,
  planBonusTotals,
} from "@/lib/performance/compensation-plan";
import { CommitPlanDialog } from "./commit-plan-dialog";
import { EditPlanDialog } from "./edit-plan-dialog";
import { PLAN_COLUMN_COUNT, PLAN_COLUMNS } from "./plan-columns";
import { PlanRow } from "./plan-row";
import { bonusRow, buildPlanRowView } from "./plan-row-view";
import { PlanToolbar } from "./plan-toolbar";
import {
  DEFAULT_PLAN_SORT,
  EMPTY_PLAN_FILTERS,
  filterPlanRows,
  hasActivePlanFilters,
  nextPlanSort,
  type PlanFilters,
  type PlanSort,
  sortPlanRows,
} from "./plan-view";
import { usePlanAutosave } from "./use-plan-autosave";

/**
 * The compensation-plan editor.
 *
 * Built on the shared `Table` primitives rather than the `EditableTable` engine:
 * that engine is a draft-then-confirm batch editor (floating save bar, diff
 * dialog), which is the opposite of save-on-edit, and it renders exactly one
 * `<tr>` per row so it has nowhere to put an expanded panel. A plain render loop
 * over real row components also sidesteps the `cell.getContext()` memoization
 * trap that engine has to work around with a context. Sorting is therefore
 * hand-rolled too — see `plan-view.ts`.
 *
 * Every edit persists on its own through `usePlanAutosave`; there is no Save
 * button. A committed plan renders the same table read-only.
 */
export function PlanEditor({
  plan,
  rates,
}: {
  plan: CompensationPlanDetail;
  rates: ExchangeRates;
}) {
  const [displayMode, setDisplayMode] =
    useState<DisplayCurrencyMode>("DEFAULT");
  const [filters, setFilters] = useState<PlanFilters>(EMPTY_PLAN_FILTERS);
  const [sort, setSort] = useState<PlanSort>(DEFAULT_PLAN_SORT);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [commitOpen, setCommitOpen] = useState(false);
  // The profile drawer opened from a row's name. Kept as a staff id + an open
  // flag (not folded into one nullable) so the id survives the close animation.
  const [profileStaffId, setProfileStaffId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  // Always the FULL item list: the hook drops drafts for items it stops seeing,
  // so handing it the filtered rows would delete a hidden row's unsaved work.
  const autosave = usePlanAutosave(plan.id, plan.items);
  const { draftFor, flushAll, flushRow } = autosave;

  // A committed plan is read-only, and so is one the server locked underneath us
  // (someone else committed it while this editor was open).
  const readOnly = plan.status === "COMMITTED" || autosave.locked;

  const staffHref = `/performance/compensation-plans/${plan.id}/staff`;

  // One derived model per row, shared by the cells and the comparator so the order
  // can never disagree with the numbers on screen. `draftFor` is memoized on the
  // draft map, so it is the dependency that tracks an edit.
  const views = useMemo(
    () =>
      plan.items.map((item) =>
        buildPlanRowView({
          item,
          draft: draftFor(item),
          displayMode,
          usdRates: rates.rates,
        }),
      ),
    [plan.items, draftFor, displayMode, rates.rates],
  );

  const visible = useMemo(
    () => sortPlanRows(filterPlanRows(views, filters), sort),
    [views, filters, sort],
  );

  /**
   * Filtering unmounts rows, so an expanded id can outlive its panel and spring
   * the row open again when the filter clears. Prune those ids and settle their
   * saves.
   *
   * The flush is deliberately not awaited: the panel's textareas are fully
   * controlled and the debounce timers live in the parent queue, so nothing is at
   * risk — this just makes a row leaving the screen save now rather than on its own
   * schedule. Awaiting would block every keystroke in the search box on the network.
   */
  useEffect(() => {
    const visibleIds = new Set(visible.map((view) => view.item.itemId));
    const hidden = [...expanded].filter((id) => !visibleIds.has(id));
    if (hidden.length === 0) return;

    setExpanded((current) => {
      const next = new Set(current);
      for (const id of hidden) next.delete(id);
      return next;
    });
    for (const id of hidden) void flushRow(id);
  }, [visible, expanded, flushRow]);

  // Over ALL items, never the filtered view: committing acts on the whole plan.
  const incompleteCount = plan.items.filter(
    (item) => draftFor(item).status !== "COMPLETE",
  ).length;

  /**
   * The round's discretionary-bonus spend.
   *
   * One currency for the whole figure, because under `DEFAULT` each row renders in
   * its own and a raw column sum would add unlike units. When the toggle forces CAD
   * or USD the total follows it; otherwise it reports in `PLAN_SUMMARY_CURRENCY`,
   * always through a currency-marked formatter so a converted number never appears
   * unlabelled.
   *
   * Plan-wide for the same reason as `incompleteCount`. The filtered subtotal is a
   * second, clearly separate figure — a filter narrows what you're looking at, not
   * what the round costs.
   */
  const summaryCurrency =
    displayMode === "DEFAULT" ? PLAN_SUMMARY_CURRENCY : displayMode;

  const bonusMoney = aggregateMoneyFormatters(summaryCurrency).money;

  const bonusTotals = useMemo(
    () =>
      planBonusTotals({
        rows: views.map(bonusRow),
        currency: summaryCurrency,
        usdRates: rates.rates,
      }),
    [views, summaryCurrency, rates.rates],
  );

  const visibleBonusTotals = useMemo(
    () =>
      planBonusTotals({
        rows: visible.map(bonusRow),
        currency: summaryCurrency,
        usdRates: rates.rates,
      }),
    [visible, summaryCurrency, rates.rates],
  );

  const saveState = aggregateSaveState(Object.values(autosave.fieldState));

  async function toggleExpanded(itemId: string) {
    if (expanded.has(itemId)) {
      // The panel is about to unmount and take its textarea state with it.
      await flushRow(itemId);
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
      return;
    }
    setExpanded((current) => new Set(current).add(itemId));
  }

  async function openCommit() {
    if (!(await flushAll())) {
      toast.error("Some edits haven't saved yet — try again in a moment.");
      return;
    }
    setCommitOpen(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Controls on their own line, filters on the next. They compete for width
          otherwise, and they answer different questions: what the whole plan is
          denominated in and what to do with it, versus who to look at. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <FilterLabel>Show amounts in</FilterLabel>
          {/* Hand-rolled rather than `SegmentedFilter`: that wrapper prepends an
              "All" segment, which is meaningless for a display currency. */}
          <ToggleGroup
            variant="outline"
            spacing={0}
            aria-label="Display currency"
            value={[displayMode]}
            onValueChange={(values) => {
              if (values.length > 0) {
                setDisplayMode(values[0] as DisplayCurrencyMode);
              }
            }}
          >
            {DISPLAY_CURRENCY_MODES.map((mode) => (
              <ToggleGroupItem key={mode} value={mode}>
                {DISPLAY_CURRENCY_LABELS[mode]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="flex items-center gap-3">
          {readOnly ? (
            <Badge variant="secondary">
              {COMPENSATION_PLAN_STATUS_LABELS.COMMITTED}
              {plan.committedAt
                ? ` · ${formatTimestamp(plan.committedAt)}`
                : ""}
              {plan.committedByName ? ` · ${plan.committedByName}` : ""}
            </Badge>
          ) : (
            <>
              <SaveIndicator
                state={saveState}
                label="Changes save automatically."
              />
              <EditPlanDialog
                planId={plan.id}
                name={plan.name}
                effectiveDate={plan.effectiveDate}
              />
              <Button variant="outline" render={<Link href={staffHref} />}>
                <IconUsers />
                Manage staff
              </Button>
              <Button onClick={openCommit} disabled={plan.items.length === 0}>
                Commit plan
              </Button>
            </>
          )}
        </div>
      </div>

      {plan.items.length > 0 ? (
        <PlanToolbar
          filters={filters}
          onFiltersChange={setFilters}
          visibleCount={visible.length}
          totalCount={plan.items.length}
        />
      ) : null}

      {plan.items.length > 0 ? (
        <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
          {bonusTotals.people === 0 ? (
            "No discretionary bonuses set yet."
          ) : (
            <>
              <span className="text-foreground">Discretionary bonuses</span>{" "}
              <span className="font-medium text-foreground tabular-nums">
                {bonusMoney(bonusTotals.total)}
              </span>{" "}
              · {bonusTotals.people}{" "}
              {bonusTotals.people === 1 ? "person" : "people"}
              {bonusTotals.percentOfCurrent != null
                ? ` · ${(bonusTotals.percentOfCurrent * 100).toFixed(1)}% of current comp`
                : ""}
              {hasActivePlanFilters(filters)
                ? ` · ${bonusMoney(visibleBonusTotals.total)} in view`
                : ""}
            </>
          )}
        </p>
      ) : null}

      {rates.stale ? (
        <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
          Exchange rates unavailable — showing approximate fallback rates.
        </p>
      ) : null}

      {autosave.locked && plan.status === "DRAFT" ? (
        <p className="rounded-md border px-3 py-2 text-sm text-destructive">
          This plan was committed by someone else while you were editing. Your
          unsaved changes weren't kept.
        </p>
      ) : null}

      {plan.items.length === 0 ? (
        <EmptyState bordered>
          No staff in this plan yet.{" "}
          <Link
            href={staffHref}
            className="text-primary underline-offset-4 hover:underline"
          >
            Choose who this round covers
          </Link>
          .
        </EmptyState>
      ) : (
        // The pane takes the leftover height and owns both scroll axes, so the
        // filters above stay put through a long plan and the columns can overflow
        // sideways rather than being squeezed. `Table` renders its own
        // `[data-slot=table-container]`, which is the element that actually
        // scrolls — reached by selector here rather than by editing the vendored
        // primitive (see docs/ui.md).
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border [&>[data-slot=table-container]]:h-full [&>[data-slot=table-container]]:overflow-auto">
          {/* Sticky on the `th`s rather than the `thead` — better supported, and it
              needs the opaque background so rows don't scroll through underneath. */}
          <Table className="[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-background">
            <TableHeader>
              <TableRow>
                {PLAN_COLUMNS.map((column) => {
                  const sortKey = column.sort;
                  return (
                    <TableHead
                      key={column.key}
                      className={cn(column.numeric && "text-right")}
                    >
                      {sortKey ? (
                        <SortHeaderButton
                          sorted={sort.key === sortKey ? sort.dir : false}
                          onClick={() =>
                            setSort((current) => nextPlanSort(current, sortKey))
                          }
                        >
                          {column.label}
                        </SortHeaderButton>
                      ) : (
                        column.label
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={PLAN_COLUMN_COUNT}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    No one in this plan matches those filters.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((view) => (
                  <PlanRow
                    key={view.item.itemId}
                    view={view}
                    usdRates={rates.rates}
                    readOnly={readOnly}
                    expanded={expanded.has(view.item.itemId)}
                    onToggleExpanded={() =>
                      void toggleExpanded(view.item.itemId)
                    }
                    onOpenProfile={() => {
                      setProfileStaffId(view.item.staffId);
                      setProfileOpen(true);
                    }}
                    onFieldChange={(field, patch) =>
                      autosave.setField(view.item.itemId, field, patch)
                    }
                    onFieldCommit={(field) =>
                      void autosave.flushField(view.item.itemId, field)
                    }
                    onPlannedText={(text) =>
                      autosave.setPlannedText(view.item.itemId, text)
                    }
                    onPlannedBonusText={(text) =>
                      autosave.setPlannedBonusText(view.item.itemId, text)
                    }
                    onPlannedCanonical={(value) =>
                      autosave.setPlannedCanonical(view.item.itemId, value)
                    }
                    onPlannedUnit={(unit) =>
                      autosave.setPlannedUnit(view.item.itemId, unit)
                    }
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Mounted once for the whole table: a per-row drawer would fetch and
          duplicate state per row. Read-only apart from its review notes. */}
      <StaffProfileDrawer
        staffId={profileStaffId}
        open={profileOpen}
        onOpenChange={setProfileOpen}
      />

      <CommitPlanDialog
        planId={plan.id}
        planName={plan.name}
        effectiveDate={plan.effectiveDate}
        staffCount={plan.items.length}
        incompleteCount={incompleteCount}
        bonusPeople={bonusTotals.people}
        bonusTotal={bonusMoney(bonusTotals.total)}
        open={commitOpen}
        onOpenChange={setCommitOpen}
      />
    </div>
  );
}
