"use client";

import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useState } from "react";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { SearchAction } from "@/lib/core/search";
import { searchEmptyMessage } from "./combobox-empty-message";

export type EntityOption = { id: string; name: string };

/**
 * A searchable, debounced multi-select on the Base UI Combobox chips. Built-in
 * filtering is off (`filter={null}`); results come from `searchAction` keyed off
 * the debounced input. Holds the selected `EntityOption[]` and reports changes.
 * Inline creation, when applicable, lives next to the field's label (see
 * `ContactsComboboxField`), not inside this dropdown.
 */
export function EntityMultiCombobox({
  value,
  onChange,
  searchAction,
  placeholder,
  invalid = false,
}: {
  value: EntityOption[];
  onChange: (next: EntityOption[]) => void;
  searchAction: SearchAction;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const { execute, reset, result, isPending } = useAction(searchAction);
  const anchor = useComboboxAnchor();

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed === "") {
      reset();
      return;
    }
    execute({ query: trimmed });
  }, [debouncedQuery, execute, reset]);

  // Keep already-selected items in the list so they render their selected
  // (checkmark) state even when absent from the current search results.
  //
  // Gate the search results on the current query: `useAction` drops out-of-order
  // responses when a *new* `execute` supersedes an older one, but clearing the
  // input calls `reset()` (not `execute`), which doesn't invalidate an in-flight
  // request — so a search still running when the field is cleared would resolve
  // and repopulate stale results. Ignoring results while the query is empty
  // keeps them from coming back after a clear.
  const items = useMemo(() => {
    const results = query.trim() === "" ? [] : (result.data ?? []);
    const missing = value.filter((v) => !results.some((r) => r.id === v.id));
    return [...missing, ...results];
  }, [query, result.data, value]);

  return (
    <Combobox
      multiple
      items={items}
      value={value}
      onValueChange={(next: EntityOption[]) => {
        onChange(next);
        setQuery("");
      }}
      isItemEqualToValue={(item: EntityOption, val: EntityOption) =>
        item.id === val.id
      }
      itemToStringLabel={(item: EntityOption) => item.name}
      filter={null}
      onInputValueChange={(next, { reason }) => {
        if (reason === "item-press") {
          setQuery("");
          return;
        }
        setQuery(next);
      }}
    >
      <ComboboxChips ref={anchor} aria-invalid={invalid || undefined}>
        {value.map((item) => (
          <ComboboxChip key={item.id} aria-label={item.name}>
            {item.name}
          </ComboboxChip>
        ))}
        <ComboboxChipsInput
          placeholder={value.length === 0 ? placeholder : ""}
        />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
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
