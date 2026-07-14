"use client";

import { searchStaff } from "@/actions/crm/searchStaff";
import { EntityCombobox } from "@/components/form/entity-combobox";
import { FormField } from "@/components/form/form-field";

type OwnerOption = { id: string; name: string };

/**
 * The CRM owner picker: a searchable, debounced single-select of active staff,
 * reporting the chosen `{ id, name } | null`. A thin wrapper over
 * `EntityCombobox` + `searchStaff`, mirroring `ManagerComboboxField`. Clearable,
 * since an owner is optional. Used on the company and contact edit dialogs; an
 * owner is a staff member (matching `opportunityOwners.staffId`).
 */
export function OwnerComboboxField({
  value,
  selectedName,
  onChange,
}: {
  value: string | null;
  selectedName: string | null;
  onChange: (next: OwnerOption | null) => void;
}) {
  const selectedItem: OwnerOption | null = value
    ? { id: value, name: selectedName ?? value }
    : null;

  return (
    <FormField label="Owner (optional)">
      <EntityCombobox
        value={selectedItem}
        onChange={(next) =>
          onChange(next ? { id: next.id, name: next.name } : null)
        }
        searchAction={searchStaff}
        placeholder="Search staff…"
      />
    </FormField>
  );
}
