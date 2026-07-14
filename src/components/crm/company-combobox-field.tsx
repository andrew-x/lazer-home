"use client";

import { useState } from "react";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { CompanyCombobox } from "./company-combobox";
import { CreateCompanyInlineDialog } from "./create-company-inline-dialog";

/**
 * The CRM company picker: search-and-select an existing company, or create one
 * inline via a small dialog (persisted immediately, then selected). Shared by the
 * contact and opportunity forms so both behave identically. Reports the chosen
 * `{ id, name } | null`; clearable, so it suits both optional (contact) and
 * required (opportunity, with `error`) uses.
 */
export function CompanyComboboxField({
  value,
  selectedName,
  onChange,
  error,
}: {
  value: string | null;
  selectedName: string | null;
  onChange: (option: { id: string; name: string } | null) => void;
  error?: string;
}) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <FormField
      label="Company"
      error={error}
      labelAction={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCreateOpen(true)}
        >
          New company
        </Button>
      }
    >
      <CompanyCombobox
        value={value}
        selectedName={selectedName}
        onChange={onChange}
      />
      <CreateCompanyInlineDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(option) => onChange(option)}
      />
    </FormField>
  );
}
