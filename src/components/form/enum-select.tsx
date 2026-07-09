"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Narrow a Select's raw string to a known enum member (or `""`). */
export function toEnumValue<T extends string>(
  options: readonly T[],
  raw: string | null,
): T | "" {
  return raw && (options as readonly string[]).includes(raw) ? (raw as T) : "";
}

/**
 * A `Select` over a string enum with human labels and a muted placeholder.
 * Shared by the CRM and projects forms so every enum dropdown behaves and looks
 * the same. Holds `T | ""` (empty = unselected).
 */
export function EnumSelect<T extends string>({
  options,
  labels,
  placeholder,
  value,
  onValueChange,
  invalid,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  placeholder: string;
  value: T | "";
  onValueChange: (value: T | "") => void;
  invalid?: boolean;
}) {
  return (
    <Select
      value={value || null}
      onValueChange={(next: string | null) =>
        onValueChange(toEnumValue(options, next))
      }
    >
      <SelectTrigger className="w-full" aria-invalid={invalid}>
        <SelectValue>
          {(v: string | null) =>
            v ? (
              labels[v as T]
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {labels[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
