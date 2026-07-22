"use client";

import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { SearchAction } from "@/lib/core/search";
import { searchEmptyMessage } from "./combobox-empty-message";
import type { EntityOption } from "./entity-multi-combobox";

/**
 * A searchable, debounced single-select on the Base UI Combobox — the
 * single-value sibling of `EntityMultiCombobox`. Built-in filtering is off
 * (`filter={null}`); results come from `searchAction` keyed off the debounced
 * input. Holds one `EntityOption | null` and is clearable. Used where a slot
 * takes exactly one entity (e.g. the staff on a project role).
 *
 * `searchArgs` passes extra, non-query arguments to the search action (e.g. a
 * `companyId` scope); a change to it re-runs the search. Callers must keep it
 * referentially stable (e.g. `useMemo`) so it doesn't re-search every render.
 */
export function EntityCombobox({
  value,
  onChange,
  searchAction,
  searchArgs,
  placeholder = "Search…",
  invalid = false,
}: {
  value: EntityOption | null;
  onChange: (next: EntityOption | null) => void;
  searchAction: SearchAction;
  searchArgs?: Record<string, unknown>;
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
    execute({ query: trimmed, ...searchArgs });
  }, [debouncedQuery, searchArgs, execute, reset]);

  // Keep the selected item in the list even when it's absent from the current
  // results, so its label and selected state render correctly.
  //
  // Gate the search results on the current query: `useAction` drops out-of-order
  // responses when a *new* `execute` supersedes an older one, but clearing the
  // input calls `reset()` (not `execute`), which doesn't invalidate an in-flight
  // request — so a search still running when the field is cleared would resolve
  // and repopulate stale results. Ignoring results while the query is empty
  // keeps them from coming back after a clear.
  const items = useMemo(() => {
    const results = query.trim() === "" ? [] : (result.data ?? []);
    if (!value || results.some((r) => r.id === value.id)) return results;
    return [value, ...results];
  }, [query, result.data, value]);

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
          {searchEmptyMessage({
            query,
            isPending,
            serverError: result.serverError,
          })}
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
