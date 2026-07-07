"use client";

import { useState } from "react";
import { searchContacts } from "@/actions/crm/searchContacts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CreateContactInlineDialog } from "./create-contact-inline-dialog";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "./entity-multi-combobox";

/**
 * The CRM contacts picker: search-and-multi-select existing contacts, or create
 * one inline via a small dialog (persisted immediately, then added to the
 * selection). Mirrors `CompanyComboboxField` — the "New contact" button sits
 * next to the label, not inside the dropdown. `label` lets the same control
 * serve both the primary contacts and referral-contacts fields.
 */
export function ContactsComboboxField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: EntityOption[];
  onChange: (next: EntityOption[]) => void;
  error?: string;
}) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCreateOpen(true)}
        >
          New contact
        </Button>
      </div>
      <EntityMultiCombobox
        value={value}
        onChange={onChange}
        searchAction={searchContacts}
        placeholder="Search contacts…"
        invalid={Boolean(error)}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <CreateContactInlineDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(option) => onChange([...value, option])}
      />
    </div>
  );
}
