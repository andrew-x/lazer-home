"use client";

import { useState } from "react";
import { searchContacts } from "@/actions/crm/searchContacts";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "@/components/form/entity-multi-combobox";
import { InlineEditField } from "@/components/form/inline-edit-field";
import { Button } from "@/components/ui/button";
import { CreateContactInlineDialog } from "../../create-contact-inline-dialog";
import { type FieldProps, useInlineSave } from "../use-inline-save";
import { EntityLinks } from "./entity-links";

export function ContactsField({ detail, refresh }: FieldProps) {
  const save = useInlineSave(detail, refresh);
  const [draft, setDraft] = useState<EntityOption[]>(detail.contacts);
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <InlineEditField
      label="Contacts"
      display={<EntityLinks items={detail.contacts} basePath="/contacts" />}
      editing={save.editing}
      isSaving={save.isPending}
      error={save.error}
      editAction={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCreateOpen(true)}
        >
          New contact
        </Button>
      }
      onEdit={() => {
        setDraft(detail.contacts);
        save.open();
      }}
      onCancel={save.close}
      onConfirm={() =>
        save.commit({ field: "contacts", contactIds: draft.map((c) => c.id) })
      }
    >
      <EntityMultiCombobox
        value={draft}
        onChange={setDraft}
        searchAction={searchContacts}
        placeholder="Search contacts…"
        invalid={Boolean(save.error)}
      />
      <CreateContactInlineDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(option) => setDraft((prev) => [...prev, option])}
      />
    </InlineEditField>
  );
}
