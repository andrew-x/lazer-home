"use client";

import { useState } from "react";
import type { EntityRef } from "@/actions/crm/getOpportunity";
import { InlineEditField } from "@/components/form/inline-edit-field";
import { InternalLink } from "@/components/internal-link";
import { CompanyCombobox } from "../../company-combobox";
import { type FieldProps, useInlineSave } from "../use-inline-save";

export function CompanyField({ detail, refresh }: FieldProps) {
  const save = useInlineSave(detail, refresh);
  const [draft, setDraft] = useState<EntityRef | null>(detail.company);
  return (
    <InlineEditField
      label="Company"
      display={
        <InternalLink
          href={`/companies/${detail.company.id}`}
          target="_blank"
          rel="noreferrer"
        >
          {detail.company.name}
        </InternalLink>
      }
      editing={save.editing}
      isSaving={save.isPending}
      error={save.error}
      onEdit={() => {
        setDraft(detail.company);
        save.open();
      }}
      onCancel={save.close}
      // A cleared company fails the schema's required rule, surfacing inline.
      onConfirm={() =>
        save.commit({ field: "companyId", companyId: draft?.id ?? "" })
      }
    >
      <CompanyCombobox
        value={draft?.id ?? null}
        selectedName={draft?.name ?? null}
        onChange={setDraft}
      />
    </InlineEditField>
  );
}
