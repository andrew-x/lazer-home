"use client";

import { useMemo } from "react";
import { searchContacts } from "@/actions/crm/searchContacts";
import { EntityCombobox } from "@/components/form/entity-combobox";
import { FormField } from "@/components/form/form-field";

type ManagerOption = { id: string; name: string };

/**
 * The contact "managed by" picker: a searchable, debounced single-select of
 * *other contacts at the same company*. A thin wrapper over `EntityCombobox`
 * that passes the given `companyId` through `searchArgs`, so `searchContacts`
 * scopes results to that company — a manager is always a colleague. Only
 * meaningful once a company is chosen, so the caller renders it conditionally
 * (and keys it by `companyId`, remounting on a company switch so no stale
 * colleague lingers). Clearable, since a manager is optional. Mirrors
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
  const selectedItem: ManagerOption | null = value
    ? { id: value, name: selectedName ?? value }
    : null;
  const searchArgs = useMemo(() => ({ companyId }), [companyId]);

  return (
    <FormField label="Managed by (optional)">
      <EntityCombobox
        value={selectedItem}
        onChange={(next) =>
          onChange(next ? { id: next.id, name: next.name } : null)
        }
        searchAction={searchContacts}
        searchArgs={searchArgs}
        placeholder="Search contacts…"
      />
    </FormField>
  );
}
