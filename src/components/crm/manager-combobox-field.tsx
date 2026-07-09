"use client";

import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useState } from "react";
import { searchContacts } from "@/actions/crm/searchContacts";
import { FormField } from "@/components/form/form-field";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

type ManagerOption = { id: string; name: string };

/**
 * The contact "managed by" picker: a searchable, debounced single-select of
 * *other contacts at the same company*. It passes the given `companyId` to
 * `searchContacts`, which scopes results to that company — a manager is always a
 * colleague. Only meaningful once a company is chosen, so the caller renders it
 * conditionally (and keys it by `companyId`, remounting on a company switch so no
 * stale colleague lingers). Clearable, since a manager is optional. Mirrors
 * `CompanyComboboxField`'s shape (`{ id, name } | null`).
 */
export function ManagerComboboxField({
  companyId,
  value,
  selectedName,
  onChange,
}: {
  companyId: string;
  value: string | null;
  selectedName: string | null;
  onChange: (next: ManagerOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const { execute, reset, result, isPending } = useAction(searchContacts);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed === "") {
      reset();
      return;
    }
    execute({ query: trimmed, companyId });
  }, [debouncedQuery, companyId, execute, reset]);

  const selectedItem: ManagerOption | null = value
    ? { id: value, name: selectedName ?? value }
    : null;

  // Keep the selected manager in the list even when it's absent from the current
  // results, so its label and selected state render correctly.
  const items = useMemo(() => {
    const results = result.data ?? [];
    if (!selectedItem || results.some((r) => r.id === selectedItem.id)) {
      return results;
    }
    return [selectedItem, ...results];
  }, [result.data, selectedItem]);

  return (
    <FormField label="Managed by (optional)">
      <Combobox
        items={items}
        value={selectedItem}
        onValueChange={(next: ManagerOption | null) =>
          onChange(next ? { id: next.id, name: next.name } : null)
        }
        isItemEqualToValue={(item: ManagerOption, val: ManagerOption) =>
          item.id === val.id
        }
        itemToStringLabel={(item: ManagerOption) => item.name}
        filter={null}
        onInputValueChange={(next, { reason }) => {
          if (reason === "item-press") return;
          setQuery(next);
        }}
      >
        <ComboboxInput
          className="w-full"
          placeholder="Search contacts…"
          showClear={Boolean(value)}
        />
        <ComboboxContent>
          <ComboboxEmpty>
            {query.trim() === ""
              ? "Type to search…"
              : isPending
                ? "Searching…"
                : result.serverError
                  ? "Search failed — try again."
                  : "No matches at this company."}
          </ComboboxEmpty>
          <ComboboxList>
            {(item: ManagerOption) => (
              <ComboboxItem key={item.id} value={item}>
                {item.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </FormField>
  );
}
