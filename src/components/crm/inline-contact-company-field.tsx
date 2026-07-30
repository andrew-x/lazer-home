"use client";

import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { searchCompanies } from "@/actions/crm/searchCompanies";
import { EmptyCell } from "@/components/empty-cell";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { InlineEditField } from "@/components/form/inline-edit-field";
import { IconButton } from "@/components/icon-button";
import { InternalLink } from "@/components/internal-link";
import { CreateCompanyInlineDialog } from "./create-company-inline-dialog";
import { useContactInlineSave } from "./use-contact-inline-save";

/**
 * The contact's employer, editable in place. Reads as a link to the company, then
 * swaps in a company picker on the pencil — with a plus button in the label row for
 * creating a company that isn't there yet (an icon rather than the forms' "New
 * company" text button, because the 320px rail also has to fit the tick and cross).
 *
 * The picker is clearable: unlike a project's client, a contact's employer is
 * optional (`contacts.companyId` is nullable — "we don't know where they work" is a
 * real state), so confirming with nothing selected unsets it.
 *
 * Moving someone to a new employer invalidates their `reports_to` link — that link
 * is only valid between colleagues — so `updateContactField`'s `company` case drops
 * it. This warns while the picker is open rather than after the save, which is the
 * job the edit dialog's warning used to do; without it the Relationships section
 * would just quietly lose a row.
 */
export function InlineContactCompanyField({
  contactId,
  canEdit,
  companyId,
  companyName,
  hasManager,
}: {
  contactId: string;
  canEdit: boolean;
  companyId: string | null;
  companyName: string | null;
  /** Whether a `reports_to` link exists, i.e. whether a move would drop one. */
  hasManager: boolean;
}) {
  const employer: EntityOption | null =
    companyId && companyName ? { id: companyId, name: companyName } : null;

  const save = useContactInlineSave(contactId);
  const [draft, setDraft] = useState<EntityOption | null>(employer);
  const [createOpen, setCreateOpen] = useState(false);

  const select = (next: EntityOption | null) => {
    save.clearError();
    setDraft(next);
  };

  return (
    <InlineEditField
      label="Company"
      display={
        employer ? (
          <InternalLink href={`/companies/${employer.id}`}>
            {employer.name}
          </InternalLink>
        ) : (
          <EmptyCell />
        )
      }
      editing={save.editing}
      canEdit={canEdit}
      isSaving={save.isPending}
      error={save.error}
      editAction={
        <IconButton label="New company" onClick={() => setCreateOpen(true)}>
          <IconPlus />
        </IconButton>
      }
      onEdit={() => {
        // Re-seed from the server value, which may have moved on since the last
        // time this field was open.
        setDraft(employer);
        save.open();
      }}
      onCancel={save.close}
      onConfirm={() =>
        save.commit({ field: "company", companyId: draft?.id ?? null })
      }
    >
      <EntityCombobox
        value={draft}
        onChange={select}
        searchAction={searchCompanies}
        placeholder="Search companies…"
        invalid={Boolean(save.error)}
      />
      {hasManager && (draft?.id ?? null) !== companyId ? (
        <p className="text-xs text-muted-foreground">
          Changing the company will clear who they report to.
        </p>
      ) : null}
      <CreateCompanyInlineDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={select}
      />
    </InlineEditField>
  );
}
