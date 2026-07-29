"use client";

import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  createCompanyContactRelationshipSchema,
  updateCompanyContactRelationshipSchema,
} from "@/actions/crm/companyContactRelationship.schema";
import { createCompanyContactRelationship } from "@/actions/crm/createCompanyContactRelationship";
import { searchCompanies } from "@/actions/crm/searchCompanies";
import { searchContacts } from "@/actions/crm/searchContacts";
import { updateCompanyContactRelationship } from "@/actions/crm/updateCompanyContactRelationship";
import { applyServerIssues } from "@/components/form/apply-server-issues";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { SuggestInput } from "@/components/form/suggest-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RELATIONSHIP_DESCRIPTION_SUGGESTIONS } from "@/lib/crm/company-contact-relationship";
import { CreateCompanyInlineDialog } from "./create-company-inline-dialog";
import { CreateContactInlineDialog } from "./create-contact-inline-dialog";

/** An existing relationship being edited — its id, the other end, and the label. */
export type EditableRelationship = {
  relationshipId: string;
  targetName: string;
  description: string;
};

type RelationshipFormValues = {
  target: EntityOption | null;
  description: string;
};

/** Only `description` is user-correctable; a bad endpoint lands on the picker. */
const ISSUE_FIELDS = {
  companyId: "target",
  contactId: "target",
  description: "description",
} as const;

/**
 * Add or edit a non-employee company ↔ contact relationship. One component serves
 * both detail pages — they differ only in which endpoint is fixed (`side` +
 * `anchorId`) and therefore which entity the picker searches — so the submit
 * shape, the description control, and the error handling stay in one place.
 *
 * Always rendered `open` by its caller and closed via `onClose`, matching
 * `ProjectRoleDialog`. The endpoints are immutable once created (the action only
 * accepts a new description), so in edit mode the target shows as a disabled
 * field and only the description is editable — re-pointing means remove + re-add.
 */
export function RelationshipDialog({
  side,
  anchorId,
  employerCompanyId,
  existing,
  onClose,
}: {
  /** Which page we're on — that entity is the fixed end of the relationship. */
  side: "company" | "contact";
  /** The fixed end's id: a company id when `side` is "company", else a contact id. */
  anchorId: string;
  /**
   * On the contact side, that contact's employer — excluded from the company
   * picker, since a relationship is by definition not employment. Ignored on the
   * company side (there the anchor company's own employees are excluded instead).
   */
  employerCompanyId?: string | null;
  existing: EditableRelationship | null;
  onClose: () => void;
}) {
  const isEdit = existing !== null;
  const [createOpen, setCreateOpen] = useState(false);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RelationshipFormValues>({
    defaultValues: {
      target: null,
      description: existing?.description ?? "",
    },
  });

  // The actions revalidate both detail pages, so closing is all we do on success.
  const create = useAction(createCompanyContactRelationship, {
    onSuccess: onClose,
  });
  const update = useAction(updateCompanyContactRelationship, {
    onSuccess: onClose,
  });

  const pending = create.isPending || update.isPending;
  const serverError =
    create.result.serverError ?? update.result.serverError ?? null;

  // Stable, or `EntityCombobox` re-runs its search every render.
  const searchArgs = useMemo(
    () =>
      side === "company"
        ? { excludeCompanyId: anchorId }
        : { excludeId: employerCompanyId ?? null },
    [side, anchorId, employerCompanyId],
  );

  const onSubmit = (values: RelationshipFormValues) => {
    if (isEdit) {
      const parsed = updateCompanyContactRelationshipSchema.safeParse({
        id: existing.relationshipId,
        description: values.description,
      });
      if (!parsed.success) {
        applyServerIssues(setError, parsed.error, ISSUE_FIELDS);
        return;
      }
      update.execute(parsed.data);
      return;
    }

    if (!values.target) {
      setError("target", {
        message: side === "company" ? "Choose a contact." : "Choose a company.",
      });
      return;
    }

    const parsed = createCompanyContactRelationshipSchema.safeParse({
      companyId: side === "company" ? anchorId : values.target.id,
      contactId: side === "company" ? values.target.id : anchorId,
      description: values.description,
    });
    if (!parsed.success) {
      applyServerIssues(setError, parsed.error, ISSUE_FIELDS);
      return;
    }
    create.execute(parsed.data);
  };

  const targetLabel = side === "company" ? "Contact" : "Company";

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={isEdit ? "Edit relationship" : "Add relationship"}
      description={
        isEdit
          ? "Reword how they relate. To point this at someone else, remove it and add a new one."
          : side === "company"
            ? "Link someone who doesn't work here — a partner's CSM, an embedded FDE, a former employee."
            : "Link a company they don't work at — one they support, invest in, or used to work for."
      }
      contentClassName="sm:max-w-sm"
    >
      {() => (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {isEdit ? (
            <FormField label={targetLabel}>
              <Input value={existing.targetName} disabled readOnly />
            </FormField>
          ) : (
            <Controller
              control={control}
              name="target"
              render={({ field }) => (
                <FormField
                  label={targetLabel}
                  error={errors.target?.message}
                  labelAction={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setCreateOpen(true)}
                    >
                      {side === "company" ? "New contact" : "New company"}
                    </Button>
                  }
                >
                  <EntityCombobox
                    value={field.value}
                    onChange={field.onChange}
                    searchAction={
                      side === "company" ? searchContacts : searchCompanies
                    }
                    searchArgs={searchArgs}
                    placeholder={
                      side === "company"
                        ? "Search contacts…"
                        : "Search companies…"
                    }
                    invalid={Boolean(errors.target)}
                  />
                  {side === "company" ? (
                    <CreateContactInlineDialog
                      open={createOpen}
                      onOpenChange={setCreateOpen}
                      onCreated={field.onChange}
                    />
                  ) : (
                    <CreateCompanyInlineDialog
                      open={createOpen}
                      onOpenChange={setCreateOpen}
                      onCreated={field.onChange}
                    />
                  )}
                </FormField>
              )}
            />
          )}

          <Controller
            control={control}
            name="description"
            render={({ field }) => (
              <FormField
                label="Relationship"
                htmlFor="relationship-description"
                error={errors.description?.message}
              >
                <SuggestInput
                  id="relationship-description"
                  value={field.value}
                  onChange={field.onChange}
                  suggestions={RELATIONSHIP_DESCRIPTION_SUGGESTIONS}
                  placeholder="CSM"
                  invalid={Boolean(errors.description)}
                />
              </FormField>
            )}
          />

          <FormDialogFooter
            serverError={serverError}
            submitLabel={isEdit ? "Save" : "Add relationship"}
            loading={pending}
          />
        </form>
      )}
    </FormDialog>
  );
}
