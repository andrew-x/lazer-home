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
 *
 * Company and contact differ only in which owner-only action they bind; the two
 * schemas are identical (`{ id, ownerId }`), so `kind` just selects the action
 * and a single `OwnerField` drives the picker for both.
 */
type InlineOwnerFieldProps = {
  kind: "company" | "contact";
  entityId: string;
  canEdit: boolean;
  ownerId: string | null;
  ownerName: string | null;
};

export function InlineOwnerField({ kind, ...props }: InlineOwnerFieldProps) {
  const action = kind === "company" ? updateCompanyOwner : updateContactOwner;
  return <OwnerField action={action} {...props} />;
}

function OwnerField({
  action,
  entityId,
  canEdit,
  ownerId,
  ownerName,
}: Omit<InlineOwnerFieldProps, "kind"> & {
  action: typeof updateCompanyOwner | typeof updateContactOwner;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EntityOption | null>(
    ownerId ? { id: ownerId, name: ownerName ?? ownerId } : null,
  );

  const owner = useAction(action, { onSuccess: () => setEditing(false) });

  const open = () => {
    setDraft(ownerId ? { id: ownerId, name: ownerName ?? ownerId } : null);
    owner.reset();
    setEditing(true);
  };
  const cancel = () => {
    owner.reset();
    setEditing(false);
  };
  const confirm = () => {
    owner.execute({ id: entityId, ownerId: draft?.id ?? null });
  };

  return (
    <InlineEditField
      label="Owner"
      display={
        ownerName ?? <span className="text-muted-foreground">Unassigned</span>
      }
      editing={editing}
      canEdit={canEdit}
      isSaving={owner.isPending}
      error={owner.result.serverError}
      onEdit={open}
      onCancel={cancel}
      onConfirm={confirm}
    >
      <EntityCombobox
        value={draft}
        onChange={setDraft}
        searchAction={searchStaff}
        placeholder="Search staff…"
        invalid={Boolean(owner.result.serverError)}
      />
    </InlineEditField>
  );
}
