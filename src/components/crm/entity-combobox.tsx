"use client";

import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useState } from "react";
import type { searchStaff } from "@/actions/crm/searchStaff";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { EntityOption } from "./entity-multi-combobox";

/** A `{ query } -> EntityOption[]` search action (searchStaff/searchContacts). */
type EntitySearchAction = typeof searchStaff;

/**
 * A searchable, debounced single-select on the Base UI Combobox — the
 * single-value sibling of `EntityMultiCombobox`. Built-in filtering is off
 * (`filter={null}`); results come from `searchAction` keyed off the debounced
 * input. Holds one `EntityOption | null` and is clearable. Used where a slot
 * takes exactly one entity (e.g. the staff on a project role).
 */
export function EntityCombobox({
  value,
  onChange,
  searchAction,
  placeholder = "Search…",
  invalid = false,
}: {
  value: EntityOption | null;
  onChange: (next: EntityOption | null) => void;
  searchAction: EntitySearchAction;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const { execute, reset, result, isPending } = useAction(searchAction);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed === "") {
      reset();
      return;
    }
    execute({ query: trimmed });
  }, [debouncedQuery, execute, reset]);

  // Keep the selected item in the list even when it's absent from the current
  // results, so its label and selected state render correctly.
  const items = useMemo(() => {
    const results = result.data ?? [];
    if (!value || results.some((r) => r.id === value.id)) return results;
    return [value, ...results];
  }, [result.data, value]);

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={(next: EntityOption | null) => onChange(next)}
      isItemEqualToValue={(item: EntityOption, val: EntityOption) =>
        item.id === val.id
      }
      itemToStringLabel={(item: EntityOption) => item.name}
      filter={null}
      onInputValueChange={(next, { reason }) => {
        if (reason === "item-press") return;
        setQuery(next);
      }}
    >
      <ComboboxInput
        className="w-full"
        placeholder={placeholder}
        showClear={Boolean(value)}
        aria-invalid={invalid || undefined}
      />
      <ComboboxContent>
        <ComboboxEmpty>
          {query.trim() === ""
            ? "Type to search…"
            : isPending
              ? "Searching…"
              : result.serverError
                ? "Search failed — try again."
                : "No matches."}
        </ComboboxEmpty>
        <ComboboxList>
          {(item: EntityOption) => (
            <ComboboxItem key={item.id} value={item}>
              {item.name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
