"use client";

import { useState } from "react";
import { searchCompanies } from "@/actions/projects/searchCompanies";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { InlineEditField } from "@/components/form/inline-edit-field";
import { InternalLink } from "@/components/internal-link";
import { useProjectInlineSave } from "./use-project-inline-save";

/**
 * The client this project delivers for, editable in place. Reads as a link to the
 * company until the pencil is clicked, then swaps in a company picker
 * (`searchCompanies` is gated on `projects.edit`, so a delivery manager can
 * re-parent a project without CRM write access).
 *
 * Re-parenting is constrained server-side: `updateProjectField`'s `company` case
 * refuses while a linked opportunity belongs to a different company, because an
 * opportunity and its project must share a client. That refusal surfaces here as the
 * field's inline error, so the field stays open and the message is actionable.
 *
 * A company is required (`projects.companyId` is `notNull`), so clearing the picker
 * leaves the field unsaveable rather than unassigning — confirming with nothing
 * selected reports the requirement instead of writing.
 */
export function ProjectCompanyField({
  projectId,
  company,
  canEdit,
}: {
  projectId: string;
  company: { id: string; name: string };
  canEdit: boolean;
}) {
  const save = useProjectInlineSave(projectId);
  const [draft, setDraft] = useState<EntityOption | null>(company);
  const [requiredError, setRequiredError] = useState<string | null>(null);

  return (
    <InlineEditField
      label="Company"
      display={
        <InternalLink href={`/companies/${company.id}`}>
          {company.name}
        </InternalLink>
      }
      editing={save.editing}
      canEdit={canEdit}
      isSaving={save.isPending}
      error={requiredError ?? save.error}
      onEdit={() => {
        setDraft(company);
        setRequiredError(null);
        save.open();
      }}
      onCancel={() => {
        setRequiredError(null);
        save.close();
      }}
      onConfirm={() => {
        if (!draft) {
          setRequiredError("Pick a company — a project must belong to one.");
          return;
        }
        setRequiredError(null);
        save.commit({ field: "company", companyId: draft.id });
      }}
    >
      <EntityCombobox
        value={draft}
        onChange={(next) => {
          setRequiredError(null);
          setDraft(next);
        }}
        searchAction={searchCompanies}
        placeholder="Search companies…"
        invalid={Boolean(requiredError ?? save.error)}
      />
    </InlineEditField>
  );
}
