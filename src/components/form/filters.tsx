"use client";

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
 * Neutral, in-memory filter controls shared across the app's list/table screens
 * (admin editable tables, the staff directory, the performance dashboard). A
 * `Select` can't hold an empty string as a value, so `ALL` is the sentinel for
 * "no filter"; the tri-state and segmented toggles use it for their "All"
 * option too.
 */
export const ALL = "ALL";

/**
 * Small uppercase caption above a filter control. Pass `htmlFor` to render a
 * real `<label>` bound to an input (e.g. a search box); otherwise a `<span>`.
 */
export function FilterLabel({
  children,
  htmlFor,
}: {
  children: string;
  htmlFor?: string;
}) {
  const className =
    "text-xs font-medium uppercase tracking-wide text-muted-foreground";
  return htmlFor ? (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  ) : (
    <span className={className}>{children}</span>
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
  triggerClassName = "w-44",
}: {
  label: string;
  value: string;
  options: readonly string[];
  labels?: Record<string, string>;
  onChange: (value: string) => void;
  /** Width/layout override for the trigger (defaults to a fixed `w-44`). */
  triggerClassName?: string;
}) {
  const display = (option: string) => labels?.[option] ?? humanizeEnum(option);
  return (
    <div className="flex flex-col gap-1.5">
      <FilterLabel>{label}</FilterLabel>
      <Select value={value} onValueChange={(next) => onChange(next ?? ALL)}>
        <SelectTrigger aria-label={label} className={triggerClassName}>
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

/**
 * Single-select segmented button group with a leading "All" segment. Wrapped in
 * an `overflow-x-auto` box so a wide group (e.g. the 9 roles) scrolls on narrow
 * viewports instead of forcing the page to. Values render through `labels` when
 * provided, else the raw option string.
 */
export function SegmentedFilter({
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
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FilterLabel>{label}</FilterLabel>
      <div className="max-w-full overflow-x-auto">
        <ToggleGroup
          variant="outline"
          spacing={0}
          aria-label={label}
          value={[value]}
          // Single-select: ignore the empty array Base UI emits when the active
          // segment is pressed again, so one segment is always selected.
          onValueChange={(values) => {
            if (values.length > 0) onChange(values[0]);
          }}
        >
          <ToggleGroupItem value={ALL}>All</ToggleGroupItem>
          {options.map((option) => (
            <ToggleGroupItem key={option} value={option}>
              {labels?.[option] ?? option}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
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
