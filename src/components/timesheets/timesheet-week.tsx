"use client";

import { IconTrash } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { SelectableProject } from "@/actions/timesheets/getSelectableProjects";
import type { TimesheetEntryView } from "@/actions/timesheets/getTimesheet";
import type { TimesheetPrefill } from "@/actions/timesheets/getTimesheetPrefill";
import { reopenTimesheet } from "@/actions/timesheets/reopenTimesheet";
import { saveTimesheet } from "@/actions/timesheets/saveTimesheet";
import { DAILY_HOUR_CAP } from "@/actions/timesheets/saveTimesheet.schema";
import { submitTimesheet } from "@/actions/timesheets/submitTimesheet";
import { IconButton } from "@/components/icon-button";
import { AddProjectDialog } from "@/components/timesheets/add-project-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/core/utils";
import { parseIsoDate } from "@/lib/format/format";
import {
  TIMESHEET_CATEGORY,
  TIMESHEET_CATEGORY_LABELS,
} from "@/lib/timesheets/timesheet-category";
import {
  applyAllocationFill,
  applyPtoFill,
  autofillProjectHours,
  buildPayload,
  buildRows,
  CATEGORY_PREFIX,
  PROJECT_PREFIX,
  parseHours,
  type Row,
  targetKey,
} from "@/lib/timesheets/timesheet-grid";
import type { TimesheetStatus } from "@/lib/timesheets/timesheet-status";
import { isWeekend } from "@/lib/timesheets/timesheet-week";

type Props = {
  staffId: string;
  weekStartDate: string;
  weekDays: string[];
  status: TimesheetStatus;
  initialEntries: TimesheetEntryView[];
  projects: SelectableProject[];
  /** Allocation + approved-PTO data for the "Fill in …" prefill buttons. */
  prefill: TimesheetPrefill;
  /** Whether this viewer may edit this week (own + in window, or the capability). */
  canEdit: boolean;
};

/**
 * One prefill option on its own line: a title, a preview of exactly what would be
 * added this week, and the "Fill in" action. When there's nothing to fill the
 * preview shows the muted reason and the button is disabled.
 */
function PrefillRow({
  title,
  preview,
  emptyLabel,
  onFill,
}: {
  title: string;
  /** What would be filled — non-empty means the button is enabled. */
  preview: string;
  emptyLabel: string;
  onFill: () => void;
}) {
  const hasData = preview.length > 0;
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {hasData ? preview : emptyLabel}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onFill}
        disabled={!hasData}
        className="shrink-0"
      >
        Fill in
      </Button>
    </div>
  );
}

/** "Mon 14" style column header for a weekday. */
function dayHeader(date: string): { weekday: string; day: string } {
  const jsDate = parseIsoDate(date);
  return {
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
      jsDate,
    ),
    day: String(jsDate.getDate()),
  };
}

export function TimesheetWeek({
  staffId,
  weekStartDate,
  weekDays,
  status,
  initialEntries,
  projects,
  prefill,
  canEdit,
}: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    buildRows(initialEntries, TIMESHEET_CATEGORY),
  );
  // Save-then-submit relay: Submit first saves the grid, then this flag tells
  // saveAction.onSuccess to chain into submitAction (a ref, not state, so the
  // in-flight callback reads the latest value without re-rendering).
  const submitAfterSave = useRef(false);

  const locked = status === "submitted";
  const editable = canEdit && !locked;

  const submitAction = useAction(submitTimesheet, {
    onSuccess: () => {
      toast.success("Timesheet submitted.");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't submit the timesheet."),
  });

  const saveAction = useAction(saveTimesheet, {
    onSuccess: () => {
      if (submitAfterSave.current) {
        submitAfterSave.current = false;
        submitAction.execute({ staffId, weekStartDate });
        return;
      }
      toast.success("Timesheet saved.");
      router.refresh();
    },
    onError: ({ error }) => {
      submitAfterSave.current = false;
      toast.error(error.serverError ?? "Couldn't save the timesheet.");
    },
  });

  const reopenAction = useAction(reopenTimesheet, {
    onSuccess: () => {
      toast.success("Timesheet reopened.");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't reopen the timesheet."),
  });

  const pending = saveAction.isPending || submitAction.isPending;

  // Live per-day and week totals.
  const dayTotals = weekDays.map((date) =>
    rows.reduce((sum, row) => sum + parseHours(row.hours[date]), 0),
  );
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);
  const overCap = dayTotals.some((t) => t > DAILY_HOUR_CAP);

  function setCell(rowKey: string, date: string, value: string) {
    setRows((prev) =>
      prev.map((row) =>
        row.key === rowKey
          ? { ...row, hours: { ...row.hours, [date]: value } }
          : row,
      ),
    );
  }

  function removeRow(rowKey: string) {
    setRows((prev) => prev.filter((row) => row.key !== rowKey));
  }

  function addTarget(value: string) {
    if (value.startsWith(PROJECT_PREFIX)) {
      const id = value.slice(PROJECT_PREFIX.length);
      const project = projects.find((p) => p.id === id);
      if (!project) return;
      const key = targetKey(id, null);
      if (rows.some((r) => r.key === key)) return;
      setRows((prev) => [
        ...prev,
        {
          key,
          label: project.name,
          sublabel: project.companyName,
          projectId: id,
          category: null,
          hours: autofillProjectHours(rows, weekDays, DAILY_HOUR_CAP),
        },
      ]);
    } else if (value.startsWith(CATEGORY_PREFIX)) {
      const raw = value.slice(CATEGORY_PREFIX.length);
      const category = TIMESHEET_CATEGORY.find((c) => c === raw);
      if (!category) return;
      const key = targetKey(null, category);
      if (rows.some((r) => r.key === key)) return;
      setRows((prev) => [
        ...prev,
        {
          key,
          label: TIMESHEET_CATEGORY_LABELS[category],
          sublabel: "Non-billable",
          projectId: null,
          category,
          hours: {},
        },
      ]);
    }
  }

  function handleFillPto() {
    setRows((prev) =>
      applyPtoFill(prev, prefill.ptoHoursByDate, weekDays, DAILY_HOUR_CAP),
    );
  }

  function handleFillAllocations() {
    setRows((prev) =>
      applyAllocationFill(prev, prefill.allocations, weekDays, DAILY_HOUR_CAP),
    );
  }

  function handleSave() {
    submitAfterSave.current = false;
    saveAction.execute(buildPayload(rows, weekDays, staffId, weekStartDate));
  }

  function handleSubmit() {
    submitAfterSave.current = true;
    saveAction.execute(buildPayload(rows, weekDays, staffId, weekStartDate));
  }

  const usedKeys = new Set(rows.map((r) => r.key));
  const allocatedProjectIds = prefill.allocations.map((a) => a.projectId);

  // Previews of exactly what each "Fill in" would add this week (an empty string
  // means there's nothing to fill, which disables the row's button).
  const allocationPreview = prefill.allocations
    .map((a) => {
      const total = Object.values(a.hoursByDate).reduce((sum, h) => sum + h, 0);
      return `${a.name} · ${total}h`;
    })
    .join(", ");
  const ptoDates = Object.keys(prefill.ptoHoursByDate).sort();
  const ptoTotal = Object.values(prefill.ptoHoursByDate).reduce(
    (sum, h) => sum + h,
    0,
  );
  const ptoPreview = ptoDates.length
    ? `${ptoDates.map((d) => dayHeader(d).weekday).join(", ")} · ${ptoTotal}h`
    : "";

  return (
    <div className="flex flex-col gap-4">
      {/* Add-row + prefill toolbar */}
      {editable ? (
        <div className="flex flex-col gap-2">
          <div>
            <AddProjectDialog
              projects={projects}
              allocatedProjectIds={allocatedProjectIds}
              usedKeys={usedKeys}
              onSelect={addTarget}
            />
          </div>
          <PrefillRow
            title="Allocations"
            preview={allocationPreview}
            emptyLabel="No allocations this week."
            onFill={handleFillAllocations}
          />
          <PrefillRow
            title="Time off (PTO)"
            preview={ptoPreview}
            emptyLabel="No approved PTO this week."
            onFill={handleFillPto}
          />
        </div>
      ) : null}

      {/* Grid */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-64">Project / Category</TableHead>
              {weekDays.map((date) => {
                const { weekday, day } = dayHeader(date);
                return (
                  <TableHead
                    key={date}
                    className={cn(
                      "text-center",
                      isWeekend(date) && "bg-muted/40",
                    )}
                  >
                    <span className="text-muted-foreground">{weekday}</span>{" "}
                    {day}
                  </TableHead>
                );
              })}
              <TableHead className="text-center">Total</TableHead>
              {editable ? <TableHead className="w-10" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={weekDays.length + (editable ? 3 : 2)}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  No time logged yet.
                  {editable
                    ? " Add a project or category above to start."
                    : null}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const rowTotal = weekDays.reduce(
                  (sum, date) => sum + parseHours(row.hours[date]),
                  0,
                );
                return (
                  <TableRow key={row.key}>
                    <TableCell>
                      <div className="font-medium">{row.label}</div>
                      {row.sublabel ? (
                        <div className="text-xs text-muted-foreground">
                          {row.sublabel}
                        </div>
                      ) : null}
                    </TableCell>
                    {weekDays.map((date) => {
                      const weekend = isWeekend(date);
                      return (
                        <TableCell
                          key={date}
                          className={cn(
                            "text-center",
                            weekend && "bg-muted/40",
                          )}
                        >
                          {weekend ? null : (
                            <Input
                              type="number"
                              step="0.25"
                              min="0"
                              max={DAILY_HOUR_CAP}
                              inputMode="decimal"
                              aria-label={`${row.label} hours on ${date}`}
                              disabled={!editable}
                              value={row.hours[date] ?? ""}
                              onChange={(e) =>
                                setCell(row.key, date, e.target.value)
                              }
                              className="mx-auto w-16 text-center"
                            />
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center font-medium tabular-nums">
                      {rowTotal || "—"}
                    </TableCell>
                    {editable ? (
                      <TableCell>
                        <IconButton
                          label={`Remove ${row.label}`}
                          size="icon-sm"
                          onClick={() => removeRow(row.key)}
                        >
                          <IconTrash />
                        </IconButton>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">Daily total</TableCell>
              {dayTotals.map((total, i) => (
                <TableCell
                  key={weekDays[i]}
                  className={cn(
                    "text-center font-medium tabular-nums",
                    isWeekend(weekDays[i]) && "bg-muted/40",
                    total > DAILY_HOUR_CAP && "text-destructive",
                  )}
                >
                  {total || "—"}
                </TableCell>
              ))}
              <TableCell className="text-center font-medium tabular-nums">
                {weekTotal || "—"}
              </TableCell>
              {editable ? <TableCell /> : null}
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {/* Actions */}
      {editable ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex items-center gap-2">
            {overCap ? (
              <span className="text-sm text-destructive">
                A day exceeds the {DAILY_HOUR_CAP}h cap.
              </span>
            ) : null}
            <Button
              variant="outline"
              onClick={handleSave}
              disabled={pending || overCap}
            >
              Save draft
            </Button>
            <Button onClick={handleSubmit} disabled={pending || overCap}>
              Submit
            </Button>
          </div>
        </div>
      ) : locked && canEdit ? (
        <div className="flex items-center justify-end gap-3">
          <span className="text-sm text-muted-foreground">
            This week is submitted. Reopen it to make changes.
          </span>
          <Button
            variant="outline"
            onClick={() => reopenAction.execute({ staffId, weekStartDate })}
            disabled={reopenAction.isPending}
          >
            Reopen
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This week is outside your editable range. Ask an admin to make
          changes.
        </p>
      )}
    </div>
  );
}
