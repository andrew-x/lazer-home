"use client";

import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useState } from "react";
import { searchCompanies } from "@/actions/crm/searchCompanies";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

type CompanyOption = { id: string; name: string };

/**
 * Searchable, debounced company picker built on the Base UI Combobox. Built-in
 * filtering is disabled (`filter={null}`); results come from a `searchCompanies`
 * action keyed off the debounced input. Reports the chosen `{ id, name }` and is
 * clearable, since a contact's company is optional.
 *
 * `searchAction` defaults to the CRM (`crm.edit`) company search; the projects
 * form passes its own `projects.edit`-gated search so a delivery manager can pick
 * a company without CRM write access.
 */
export function CompanyCombobox({
  value,
  selectedName,
  onChange,
  searchAction = searchCompanies,
}: {
  value: string | null;
  selectedName: string | null;
  onChange: (next: CompanyOption | null) => void;
  searchAction?: typeof searchCompanies;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const { execute, reset, result, isPending } = useAction(searchAction);

  // Only search once there's something to search on; a blank query clears any
  // prior results rather than listing everything.
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed === "") {
      reset();
      return;
    }
    execute({ query: trimmed });
  }, [debouncedQuery, execute, reset]);

  const selectedItem: CompanyOption | null = value
    ? { id: value, name: selectedName ?? value }
    : null;

  // Keep the selected company in the list even when it's not in the current
  // search results, so its label and selected state render correctly.
  const items = useMemo(() => {
    const results = result.data ?? [];
    if (!selectedItem || results.some((r) => r.id === selectedItem.id)) {
      return results;
    }
    return [selectedItem, ...results];
  }, [result.data, selectedItem]);

  return (
    <Combobox
      items={items}
      value={selectedItem}
      onValueChange={(next: CompanyOption | null) =>
        onChange(next ? { id: next.id, name: next.name } : null)
      }
      isItemEqualToValue={(item: CompanyOption, val: CompanyOption) =>
        item.id === val.id
      }
      itemToStringLabel={(item: CompanyOption) => item.name}
      filter={null}
      onInputValueChange={(next, { reason }) => {
        if (reason === "item-press") return;
        setQuery(next);
      }}
    >
      <ComboboxInput
        className="w-full"
        placeholder="Search companies…"
        showClear={Boolean(value)}
      />
      <ComboboxContent>
        <ComboboxEmpty>
          {query.trim() === ""
            ? "Type to search companies…"
            : isPending
              ? "Searching…"
              : result.serverError
                ? "Search failed — try again."
                : "No companies found."}
        </ComboboxEmpty>
        <ComboboxList>
          {(item: CompanyOption) => (
            <ComboboxItem key={item.id} value={item}>
              {item.name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
