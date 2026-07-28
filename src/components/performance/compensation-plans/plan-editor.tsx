"use client";

import { IconUsers } from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { CompensationPlanDetail } from "@/actions/performance/getCompensationPlan";
import type { ExchangeRates } from "@/actions/staff/getExchangeRates";
import { EmptyState } from "@/components/empty-state";
import { FilterLabel } from "@/components/form/filters";
import {
  aggregateSaveState,
  SaveIndicator,
} from "@/components/form/save-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatTimestamp } from "@/lib/format/format";
import {
  COMPENSATION_PLAN_STATUS_LABELS,
  DISPLAY_CURRENCY_LABELS,
  DISPLAY_CURRENCY_MODES,
  type DisplayCurrencyMode,
} from "@/lib/performance/compensation-plan";
import { CommitPlanDialog } from "./commit-plan-dialog";
import { EditPlanDialog } from "./edit-plan-dialog";
import { PLAN_COLUMNS } from "./plan-columns";
import { PlanRow } from "./plan-row";
import { usePlanAutosave } from "./use-plan-autosave";

/**
 * The compensation-plan editor.
 *
 * Built on the shared `Table` primitives rather than the `EditableTable` engine:
 * that engine is a draft-then-confirm batch editor (floating save bar, diff
 * dialog), which is the opposite of save-on-edit, and it renders exactly one
 * `<tr>` per row so it has nowhere to put an expanded panel. A plain render loop
 * over real row components also sidesteps the `cell.getContext()` memoization
 * trap that engine has to work around with a context.
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [commitOpen, setCommitOpen] = useState(false);

  const autosave = usePlanAutosave(plan.id, plan.items);
  const { flushAll, flushRow } = autosave;

  // A committed plan is read-only, and so is one the server locked underneath us
  // (someone else committed it while this editor was open).
  const readOnly = plan.status === "COMMITTED" || autosave.locked;

  const staffHref = `/performance/compensation-plans/${plan.id}/staff`;

  const incompleteCount = plan.items.filter(
    (item) => !autosave.draftFor(item).isComplete,
  ).length;

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <FilterLabel>Show amounts in</FilterLabel>
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
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {PLAN_COLUMNS.map((column) => (
                  <TableHead key={column.key}>{column.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.items.map((item) => {
                return (
                  <PlanRow
                    key={item.itemId}
                    item={item}
                    draft={autosave.draftFor(item)}
                    displayMode={displayMode}
                    usdRates={rates.rates}
                    readOnly={readOnly}
                    expanded={expanded.has(item.itemId)}
                    onToggleExpanded={() => void toggleExpanded(item.itemId)}
                    onFieldChange={(field, patch) =>
                      autosave.setField(item.itemId, field, patch)
                    }
                    onFieldCommit={(field) =>
                      void autosave.flushField(item.itemId, field)
                    }
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <CommitPlanDialog
        planId={plan.id}
        planName={plan.name}
        effectiveDate={plan.effectiveDate}
        staffCount={plan.items.length}
        incompleteCount={incompleteCount}
        open={commitOpen}
        onOpenChange={setCommitOpen}
      />
    </div>
  );
}
