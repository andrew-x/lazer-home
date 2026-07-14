"use client";

import { IconTrash } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { SelectableProject } from "@/actions/timesheets/getSelectableProjects";
import type { TimesheetEntryView } from "@/actions/timesheets/getTimesheet";
import { reopenTimesheet } from "@/actions/timesheets/reopenTimesheet";
import { saveTimesheet } from "@/actions/timesheets/saveTimesheet";
import { DAILY_HOUR_CAP } from "@/actions/timesheets/saveTimesheet.schema";
import { submitTimesheet } from "@/actions/timesheets/submitTimesheet";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TIMESHEET_CATEGORY,
  TIMESHEET_CATEGORY_LABELS,
  type TimesheetCategory,
} from "@/lib/timesheet-category";
import { isWeekend } from "@/lib/timesheet-week";
import { cn } from "@/lib/utils";

/** A grid row: one target (project or category) with a value per weekday. */
type Row = {
  key: string;
  label: string;
  sublabel: string | null;
  projectId: string | null;
  category: TimesheetCategory | null;
  hours: Record<string, string>;
};

type Props = {
  staffId: string;
  weekStartDate: string;
  weekDays: string[];
  status: "draft" | "submitted";
  initialEntries: TimesheetEntryView[];
  projects: SelectableProject[];
  /** Whether this viewer may edit this week (own + in window, or the capability). */
  canEdit: boolean;
};

const PROJECT_PREFIX = "project:";
const CATEGORY_PREFIX = "category:";

function targetKey(
  projectId: string | null,
  category: TimesheetCategory | null,
): string {
  return projectId
    ? `${PROJECT_PREFIX}${projectId}`
    : `${CATEGORY_PREFIX}${category}`;
}

/** Parse a cell's raw text into non-negative hours (blank / invalid → 0). */
function parseHours(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** "Mon 14" style column header for a weekday. */
function dayHeader(date: string): { weekday: string; day: string } {
  const [y, m, d] = date.split("-").map(Number);
  const jsDate = new Date(y, m - 1, d);
  return {
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
      jsDate,
    ),
    day: String(d),
  };
}

/** Group the flat entries into one row per target, preserving stable ordering. */
function buildRows(
  entries: TimesheetEntryView[],
  categoryOrder: readonly TimesheetCategory[],
): Row[] {
  const byKey = new Map<string, Row>();
  for (const e of entries) {
    const key = targetKey(e.projectId, e.category);
    let row = byKey.get(key);
    if (!row) {
      row = {
        key,
        label:
          e.projectName ??
          (e.category ? TIMESHEET_CATEGORY_LABELS[e.category] : "—"),
        sublabel: e.projectId ? e.companyName : "Non-billable",
        projectId: e.projectId,
        category: e.category,
        hours: {},
      };
      byKey.set(key, row);
    }
    row.hours[e.date] = String(e.hours);
  }
  const rows = [...byKey.values()];
  // A category row's rank in the canonical order (project rows never reach here).
  const categoryRank = (category: TimesheetCategory | null) =>
    category ? categoryOrder.indexOf(category) : -1;
  // Projects (alpha) first, then non-billable categories in their canonical order.
  return rows.sort((a, b) => {
    if (a.projectId && b.projectId) return a.label.localeCompare(b.label);
    if (a.projectId) return -1;
    if (b.projectId) return 1;
    return categoryRank(a.category) - categoryRank(b.category);
  });
}

export function TimesheetWeek({
  staffId,
  weekStartDate,
  weekDays,
  status,
  initialEntries,
  projects,
  canEdit,
}: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    buildRows(initialEntries, TIMESHEET_CATEGORY),
  );
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

  /**
   * Hours to prefill a newly-added PROJECT row with: each weekday's remaining
   * capacity (8h minus what's already logged that day), so a project soaks up
   * unallocated weekday time. Weekends stay blank. Non-billable rows get nothing.
   */
  function autofillProjectHours(): Record<string, string> {
    const filled: Record<string, string> = {};
    for (const date of weekDays) {
      if (isWeekend(date)) continue;
      const used = rows.reduce(
        (sum, row) => sum + parseHours(row.hours[date]),
        0,
      );
      const remaining = DAILY_HOUR_CAP - used;
      if (remaining > 0) filled[date] = String(remaining);
    }
    return filled;
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
          hours: autofillProjectHours(),
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

  function buildPayload() {
    const entries = rows.flatMap((row) =>
      weekDays
        .map((date) => ({ date, hours: parseHours(row.hours[date]) }))
        .filter((cell) => cell.hours > 0)
        .map((cell) => ({
          date: cell.date,
          projectId: row.projectId,
          category: row.category,
          hours: cell.hours,
        })),
    );
    return { staffId, weekStartDate, entries };
  }

  function handleSave() {
    submitAfterSave.current = false;
    saveAction.execute(buildPayload());
  }

  function handleSubmit() {
    submitAfterSave.current = true;
    saveAction.execute(buildPayload());
  }

  const usedKeys = new Set(rows.map((r) => r.key));
  const availableProjects = projects.filter(
    (p) => !usedKeys.has(targetKey(p.id, null)),
  );
  const availableCategories = TIMESHEET_CATEGORY.filter(
    (c) => !usedKeys.has(targetKey(null, c)),
  );

  return (
    <div className="flex flex-col gap-4">
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
                    ? " Add a project or category below to start."
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Select
            value={null}
            onValueChange={(v: string | null) => v && addTarget(v)}
          >
            <SelectTrigger
              className="w-72"
              aria-label="Add a project or category"
            >
              <SelectValue>
                {() => (
                  <span className="text-muted-foreground">
                    Add a project or category…
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableProjects.length > 0 ? (
                <SelectGroup>
                  <SelectLabel>Projects</SelectLabel>
                  {availableProjects.map((p) => (
                    <SelectItem key={p.id} value={`${PROJECT_PREFIX}${p.id}`}>
                      {p.name}
                      <span className="text-muted-foreground">
                        {" "}
                        · {p.companyName}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
              {availableCategories.length > 0 ? (
                <SelectGroup>
                  <SelectLabel>Non-billable</SelectLabel>
                  {availableCategories.map((c) => (
                    <SelectItem key={c} value={`${CATEGORY_PREFIX}${c}`}>
                      {TIMESHEET_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
            </SelectContent>
          </Select>

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
