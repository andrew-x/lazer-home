"use client";

import { useState } from "react";
import { searchStaff } from "@/actions/crm/searchStaff";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "@/components/form/entity-multi-combobox";
import { InlineEditField } from "@/components/form/inline-edit-field";
import { type FieldProps, useInlineSave } from "../use-inline-save";
import { EntityLinks } from "./entity-links";

export function OwnersField({ detail, refresh }: FieldProps) {
  const save = useInlineSave(detail, refresh);
  const [draft, setDraft] = useState<EntityOption[]>(detail.owners);
  return (
    <InlineEditField
      label="Owners"
      display={<EntityLinks items={detail.owners} basePath="/staff" />}
      editing={save.editing}
      isSaving={save.isPending}
      error={save.error}
      onEdit={() => {
        setDraft(detail.owners);
        save.open();
      }}
      onCancel={save.close}
      onConfirm={() =>
        save.commit({ field: "owners", ownerIds: draft.map((o) => o.id) })
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
