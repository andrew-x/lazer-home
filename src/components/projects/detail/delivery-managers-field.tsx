"use client";

import { useState } from "react";
import { searchStaff } from "@/actions/projects/searchStaff";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "@/components/form/entity-multi-combobox";
import { InlineEditField } from "@/components/form/inline-edit-field";
import { InternalLink } from "@/components/internal-link";
import { useProjectInlineSave } from "./use-project-inline-save";

/**
 * The project's delivery managers, editable in place on the project detail page.
 * Reads as a list of links to each manager's staff profile until the pencil is
 * clicked, then swaps in a staff multi-picker with confirm/cancel. Confirming calls
 * the field-scoped `updateProjectField` with the `deliveryManagers` variant, which
 * writes only the delivery-manager junction — so it can't clobber a concurrent name
 * edit. That action revalidates this route, so the display refreshes on success (no
 * manual refetch).
 *
 * `InlineEditField` has no em-dash fallback of its own (unlike `MetaField`), so the
 * empty state is spelled out here.
 */
export function DeliveryManagersField({
  projectId,
  deliveryManagers,
  canEdit,
}: {
  projectId: string;
  deliveryManagers: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const save = useProjectInlineSave(projectId);
  const [draft, setDraft] = useState<EntityOption[]>(deliveryManagers);

  return (
    <InlineEditField
      label="Delivery managers"
      display={
        deliveryManagers.length > 0 ? (
          <span className="flex flex-wrap items-center gap-x-1">
            {deliveryManagers.map((manager, index) => (
              <span key={manager.id}>
                <InternalLink href={`/staff/${manager.id}`}>
                  {manager.name}
                </InternalLink>
                {index < deliveryManagers.length - 1 ? "," : null}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        )
      }
      editing={save.editing}
      canEdit={canEdit}
      isSaving={save.isPending}
      error={save.error}
      onEdit={() => {
        setDraft(deliveryManagers);
        save.open();
      }}
      onCancel={save.close}
      onConfirm={() =>
        save.commit({
          field: "deliveryManagers",
          deliveryManagerIds: draft.map((manager) => manager.id),
        })
      }
    >
      <EntityMultiCombobox
        value={draft}
        onChange={setDraft}
        searchAction={searchStaff}
        placeholder="Search staff…"
        invalid={Boolean(save.error)}
      />
    </InlineEditField>
  );
}
