"use client";

import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { searchStaff } from "@/actions/crm/searchStaff";
import { updateCompanyOwner } from "@/actions/crm/updateCompanyOwner";
import { updateContactOwner } from "@/actions/crm/updateContactOwner";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { InlineEditField } from "@/components/form/inline-edit-field";

/**
 * The CRM owner, editable in place on a company or contact detail page — the
 * single-select counterpart of the opportunity drawer's (multi) owners field.
 * Reads as text until the pencil is clicked, then swaps in a staff picker with
 * confirm/cancel. Confirming calls the entity's *owner-only* update action
 * (`updateCompanyOwner`/`updateContactOwner`), which writes just `ownerId` — so
 * it neither clobbers a field edited concurrently elsewhere nor re-runs the
 * contact's manager rule on an unrelated change. Those actions `revalidatePath`
 * their detail route, so the server-rendered display refreshes on success (no
 * manual refetch).
 */
type InlineOwnerFieldProps = {
  kind: "company" | "contact";
  entityId: string;
  canEdit: boolean;
  ownerId: string | null;
  ownerName: string | null;
};

export function InlineOwnerField({
  kind,
  entityId,
  canEdit,
  ownerId,
  ownerName,
}: InlineOwnerFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EntityOption | null>(
    ownerId ? { id: ownerId, name: ownerName ?? ownerId } : null,
  );

  const onSuccess = () => setEditing(false);
  // Both hooks run so the picker's action stays fixed for the field's lifetime;
  // `active` selects this entity's action, and `confirm` calls the concrete one
  // (a single ternary-derived `execute` can't be typed against either input).
  const companyAction = useAction(updateCompanyOwner, { onSuccess });
  const contactAction = useAction(updateContactOwner, { onSuccess });
  const active = kind === "company" ? companyAction : contactAction;

  const open = () => {
    setDraft(ownerId ? { id: ownerId, name: ownerName ?? ownerId } : null);
    active.reset();
    setEditing(true);
  };
  const cancel = () => {
    active.reset();
    setEditing(false);
  };
  const confirm = () => {
    const nextOwnerId = draft?.id ?? null;
    if (kind === "company") {
      companyAction.execute({ id: entityId, ownerId: nextOwnerId });
    } else {
      contactAction.execute({ id: entityId, ownerId: nextOwnerId });
    }
  };

  return (
    <InlineEditField
      label="Owner"
      display={
        ownerName ?? <span className="text-muted-foreground">Unassigned</span>
      }
      editing={editing}
      canEdit={canEdit}
      isSaving={active.isPending}
      error={active.result.serverError}
      onEdit={open}
      onCancel={cancel}
      onConfirm={confirm}
    >
      <EntityCombobox
        value={draft}
        onChange={setDraft}
        searchAction={searchStaff}
        placeholder="Search staff…"
        invalid={Boolean(active.result.serverError)}
      />
    </InlineEditField>
  );
}
