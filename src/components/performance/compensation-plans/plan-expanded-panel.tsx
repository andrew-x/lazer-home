"use client";

import { IconInfoCircle } from "@tabler/icons-react";
import type { CompensationPlanEditorItem } from "@/actions/performance/getCompensationPlan";
import { EmptyCell } from "@/components/empty-cell";
import { FilterLabel } from "@/components/form/filters";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type Currency, formatMoney } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/format";
import {
  NEW_JOINER_MONTHS,
  type PlanChange,
} from "@/lib/performance/compensation-plan";
import {
  rubricForRole,
  SUBRATING_LEVELS,
  type Subratings,
} from "@/lib/performance/rating-rubric";
import { formatLevel, UNRATED_SELECT_VALUE } from "@/lib/staff/staff-rating";
import { formatChangeAmount, formatChangePercent } from "./plan-format";

/**
 * The expanded detail for one plan row: the context a compensation conversation
 * needs, the person's own subrating rubric, and the two note fields.
 *
 * Subratings live here rather than as columns because the rubric is per-role: a
 * grid can only show one role's categories at a time (which is why the
 * edit-levels screen makes you filter to a single role first), whereas a per-row
 * panel shows each person's own rubric and lets a mixed-role plan be scored in
 * one pass.
 */
export function PlanExpandedPanel({
  item,
  panelId,
  subratings,
  evaluationNotes,
  compensationNotes,
  previousChange,
  displayCurrency,
  readOnly,
  onSubratingChange,
  onNotesChange,
  onNotesCommit,
}: {
  item: CompensationPlanEditorItem;
  panelId: string;
  subratings: Subratings;
  evaluationNotes: string;
  compensationNotes: string;
  previousChange: PlanChange;
  displayCurrency: Currency | null;
  readOnly: boolean;
  onSubratingChange: (next: Subratings) => void;
  onNotesChange: (
    field: "evaluationNotes" | "compensationNotes",
    next: string,
  ) => void;
  onNotesCommit: (field: "evaluationNotes" | "compensationNotes") => void;
}) {
  const rubric = rubricForRole(item.role);
  const isNewJoiner =
    item.monthsSinceJoin != null && item.monthsSinceJoin < NEW_JOINER_MONTHS;

  return (
    <div
      id={panelId}
      className="flex flex-col gap-6 border-t bg-muted/30 px-6 py-5"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Joined">
          {item.joinDate ? (
            <span className="flex items-center gap-2">
              {formatDate(item.joinDate)}
              {isNewJoiner ? (
                <Badge variant="outline">
                  {item.monthsSinceJoin === 1
                    ? "1 month"
                    : `${item.monthsSinceJoin} months`}
                </Badge>
              ) : null}
            </span>
          ) : (
            <EmptyCell />
          )}
        </Fact>

        <Fact label="Last evaluation">
          {item.lastRatedOn ? (
            <span className="flex items-center gap-1.5">
              {formatLevel(item.lastLevel)}
              <WhenTooltip label="Rated" date={item.lastRatedOn} />
            </span>
          ) : (
            <span className="text-muted-foreground">Never rated</span>
          )}
        </Fact>

        <Fact label="Previous change">
          {previousChange.changeAmount != null && displayCurrency ? (
            <span className="flex items-center gap-1.5 tabular-nums">
              {formatChangeAmount(previousChange.changeAmount, displayCurrency)}
              <span className="text-muted-foreground">·</span>
              {formatChangePercent(previousChange.changePercent)}
              {item.current.effectiveFrom ? (
                <WhenTooltip
                  label="Effective"
                  date={item.current.effectiveFrom}
                />
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">No previous change</span>
          )}
        </Fact>

        <Fact label="Current on file">
          {item.current.amount != null && item.current.currency ? (
            <span className="tabular-nums">
              {formatMoney(item.current.amount, item.current.currency, {
                maximumFractionDigits: 0,
              })}
              {item.current.employmentType === "HOURLY" ? "/hr" : ""}
            </span>
          ) : (
            <EmptyCell />
          )}
        </Fact>
      </div>

      <div className="flex flex-col gap-3 border-t pt-5">
        <FilterLabel>Subratings</FilterLabel>
        {rubric.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No subrating rubric for this role yet.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {rubric.map((category) => {
              const value = subratings[category.key];
              return (
                <div key={category.key} className="flex flex-col gap-1.5">
                  <Label>{category.label}</Label>
                  <Select
                    value={value == null ? UNRATED_SELECT_VALUE : String(value)}
                    disabled={readOnly}
                    onValueChange={(next) => {
                      if (!next) return;
                      const updated = { ...subratings };
                      if (next === UNRATED_SELECT_VALUE) {
                        delete updated[category.key];
                      } else {
                        updated[category.key] = Number(next);
                      }
                      onSubratingChange(updated);
                    }}
                  >
                    <SelectTrigger size="sm" aria-label={category.label}>
                      <SelectValue>
                        {(current: string | null) =>
                          !current || current === UNRATED_SELECT_VALUE
                            ? "No rating"
                            : formatLevel(Number(current))
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNRATED_SELECT_VALUE}>
                        No rating
                      </SelectItem>
                      {SUBRATING_LEVELS.map((level) => (
                        <SelectItem key={level} value={String(level)}>
                          {formatLevel(level)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-4 border-t pt-5 lg:grid-cols-2">
        <NotesField
          label="Evaluation notes"
          value={evaluationNotes}
          readOnly={readOnly}
          onChange={(next) => onNotesChange("evaluationNotes", next)}
          onCommit={() => onNotesCommit("evaluationNotes")}
        />
        <NotesField
          label="Compensation update notes"
          value={compensationNotes}
          readOnly={readOnly}
          onChange={(next) => onNotesChange("compensationNotes", next)}
          onCommit={() => onNotesCommit("compensationNotes")}
        />
      </div>
    </div>
  );
}

/**
 * The "when" behind a fact, as an icon rather than inline text.
 *
 * These dates are context you occasionally want, not something to scan across
 * rows — spelling them out inline made every fact two-line and ragged, which is
 * what the grid is here to avoid.
 */
function WhenTooltip({ label, date }: { label: string; date: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <IconInfoCircle
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-label={`${label} ${formatDate(date)}`}
          />
        }
      />
      <TooltipContent>
        {label} {formatDate(date)}
      </TooltipContent>
    </Tooltip>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <FilterLabel>{label}</FilterLabel>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function NotesField({
  label,
  value,
  readOnly,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  onChange: (next: string) => void;
  onCommit: () => void;
}) {
  if (readOnly) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>{label}</Label>
        <p className="text-sm whitespace-pre-wrap">
          {value || <span className="text-muted-foreground">None</span>}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Textarea
        rows={4}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
      />
    </div>
  );
}
