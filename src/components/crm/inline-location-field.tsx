"use client";

import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { searchCities } from "@/actions/cities/searchCities";
import { updateCompanyLocation } from "@/actions/crm/updateCompanyLocation";
import { updateContactLocation } from "@/actions/crm/updateContactLocation";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { InlineEditField } from "@/components/form/inline-edit-field";

/**
 * The location ("City, CC"), editable in place on a company or contact detail
 * page. Reads as text until the pencil is clicked, then swaps in a city picker
 * (backed by the static world-cities list via `searchCities`) with confirm/cancel.
 * Confirming calls the entity's *location-only* update action, which writes just
 * `location` and `revalidatePath`s its detail route, so the server-rendered
 * display refreshes on success (no manual refetch).
 *
 * Location is stored as the label string itself, so the combobox's
 * `EntityOption` uses that label for both `id` and `name`. Company and contact
 * differ only in which location-only action they bind; the two schemas are
 * identical (`{ id, location }`), so `kind` just selects the action.
 */
type InlineLocationFieldProps = {
  kind: "company" | "contact";
  entityId: string;
  canEdit: boolean;
  location: string | null;
};

export function InlineLocationField({
  kind,
  ...props
}: InlineLocationFieldProps) {
  const action =
    kind === "company" ? updateCompanyLocation : updateContactLocation;
  return <LocationField action={action} {...props} />;
}

function LocationField({
  action,
  entityId,
  canEdit,
  location,
}: Omit<InlineLocationFieldProps, "kind"> & {
  action: typeof updateCompanyLocation | typeof updateContactLocation;
}) {
  const toOption = (value: string | null): EntityOption | null =>
    value ? { id: value, name: value } : null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EntityOption | null>(toOption(location));

  const save = useAction(action, { onSuccess: () => setEditing(false) });

  const open = () => {
    setDraft(toOption(location));
    save.reset();
    setEditing(true);
  };
  const cancel = () => {
    save.reset();
    setEditing(false);
  };
  const confirm = () => {
    save.execute({ id: entityId, location: draft?.id ?? null });
  };

  return (
    <InlineEditField
      label="Location"
      display={
        location ?? <span className="text-muted-foreground">Unknown</span>
      }
      editing={editing}
      canEdit={canEdit}
      isSaving={save.isPending}
      error={save.result.serverError}
      onEdit={open}
      onCancel={cancel}
      onConfirm={confirm}
    >
      <EntityCombobox
        value={draft}
        onChange={setDraft}
        searchAction={searchCities}
        placeholder="Search a city…"
        invalid={Boolean(save.result.serverError)}
      />
    </InlineEditField>
  );
}
