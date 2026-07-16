"use client";

import {
  IconChevronDown,
  IconChevronUp,
  IconSelector,
} from "@tabler/icons-react";
import type { Column } from "@tanstack/react-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { humanizeEnum } from "@/lib/format";

/**
 * Shared filter/header primitives for the admin editable tables. A `Select`
 * can't hold an empty string as a value, so `ALL` is the sentinel for "no
 * filter"; the tri-state toggle uses it for its "All" option too.
 */
export const ALL = "ALL";

/** Sortable column header — click cycles asc → desc, with an arrow indicator. */
export function SortHeader<TData>({
  column,
  children,
}: {
  column: Column<TData, unknown>;
  children: string;
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(sorted === "asc")}
      className="-mx-1 flex items-center gap-1 rounded-sm px-1 hover:text-foreground"
    >
      {children}
      {sorted === "asc" ? (
        <IconChevronUp className="size-3.5" />
      ) : sorted === "desc" ? (
        <IconChevronDown className="size-3.5" />
      ) : (
        <IconSelector className="size-3.5 text-muted-foreground" />
      )}
    </button>
  );
}

/** Small uppercase caption above a filter control. */
export function FilterLabel({ children }: { children: string }) {
  return (
    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

/**
 * Single-select filter over a list of enum options, with an "All" escape. Pass
 * `labels` to render values through a single-source label map (e.g. the staff
 * enums); without it, options fall back to `humanizeEnum`.
 */
export function SelectFilter({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  labels?: Record<string, string>;
  onChange: (value: string) => void;
}) {
  const display = (option: string) => labels?.[option] ?? humanizeEnum(option);
  return (
    <div className="flex flex-col gap-1.5">
      <FilterLabel>{label}</FilterLabel>
      <Select value={value} onValueChange={(next) => onChange(next ?? ALL)}>
        <SelectTrigger aria-label={label} className="w-44">
          <SelectValue>
            {(current: string | null) =>
              !current || current === ALL ? "All" : display(current)
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {display(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The All / Yes / No options backing every {@link TriStateFilter}. */
export const TRISTATE = [
  { value: ALL, label: "All" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

/** Boolean filter with an explicit "All" (unset) state. */
export function TriStateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FilterLabel>{label}</FilterLabel>
      <ToggleGroup
        variant="outline"
        spacing={0}
        aria-label={label}
        value={[value]}
        onValueChange={(values) => {
          if (values.length > 0) onChange(values[0]);
        }}
      >
        {TRISTATE.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
