"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>Company</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCreateOpen(true)}
        >
          New company
        </Button>
      </div>
      <CompanyCombobox
        value={value}
        selectedName={selectedName}
        onChange={onChange}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <CreateCompanyInlineDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(option) => onChange(option)}
      />
    </div>
  );
}
