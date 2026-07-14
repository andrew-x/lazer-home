"use client";

import { searchCompanies } from "@/actions/crm/searchCompanies";
import { EntityCombobox } from "@/components/form/entity-combobox";

type CompanyOption = { id: string; name: string };

/**
 * Searchable, debounced company picker. A thin wrapper over `EntityCombobox`
 * that adapts its `{ id, name }` option shape to the flat `{ value, selectedName }`
 * props the CRM/projects forms hold. Reports the chosen `{ id, name }` and is
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
  const selectedItem: CompanyOption | null = value
    ? { id: value, name: selectedName ?? value }
    : null;

  return (
    <EntityCombobox
      value={selectedItem}
      onChange={(next) =>
        onChange(next ? { id: next.id, name: next.name } : null)
      }
      searchAction={searchAction}
      placeholder="Search companies…"
    />
  );
}
