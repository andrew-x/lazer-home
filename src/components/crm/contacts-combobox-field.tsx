"use client";

import { useState } from "react";
import { searchContacts } from "@/actions/crm/searchContacts";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "@/components/form/entity-multi-combobox";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { CreateContactInlineDialog } from "./create-contact-inline-dialog";

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
    <FormField
      label={label}
      error={error}
      labelAction={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCreateOpen(true)}
        >
          New contact
        </Button>
      }
    >
      <EntityMultiCombobox
        value={value}
        onChange={onChange}
        searchAction={searchContacts}
        placeholder="Search contacts…"
        invalid={Boolean(error)}
      />
      <CreateContactInlineDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(option) => onChange([...value, option])}
      />
    </FormField>
  );
}
