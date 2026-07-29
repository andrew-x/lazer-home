"use client";

import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import {
  createContactRelationshipSchema,
  updateContactRelationshipSchema,
} from "@/actions/crm/contactRelationship.schema";
import { createContactRelationship } from "@/actions/crm/createContactRelationship";
import { searchContacts } from "@/actions/crm/searchContacts";
import { updateContactRelationship } from "@/actions/crm/updateContactRelationship";
import { applyServerIssues } from "@/components/form/apply-server-issues";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { EnumSelect } from "@/components/form/enum-select";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { SuggestInput } from "@/components/form/suggest-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CONTACT_RELATION_SUGGESTIONS,
  CONTACT_RELATIONSHIP_KIND_HINTS,
  CONTACT_RELATIONSHIP_KIND_LABELS,
  type ContactRelationshipKind,
  MANAGER_NEEDS_COMPANY_HINT,
  managerAlreadySetSentence,
  successionSideEffectSentence,
} from "@/lib/crm/contact-relationship";
import { CreateContactInlineDialog } from "./create-contact-inline-dialog";

/** An existing `related` link being reworded — the only editable kind. */
export type EditableContactRelationship = {
  relationshipId: string;
  targetName: string;
  description: string;
};

type FormValues = {
  kind: ContactRelationshipKind;
  target: EntityOption | null;
  description: string;
};

/** Only `description` is user-correctable; a bad endpoint lands on the picker. */
const ISSUE_FIELDS = {
  kind: "kind",
  contactId: "target",
  relatedContactId: "target",
  description: "description",
} as const;

/**
 * Add (or reword) one contact ↔ contact relationship. A single dialog for all three
 * kinds behind a `kind` selector — the same move `RelationshipDialog` makes with its
 * `side` discriminator — because they share the contact picker, the create action,
 * and every bit of the submit/error/close plumbing; only the description's presence
 * differs.
 *
 * **Field order is contact, then type**: you pick the person, then say how they
 * relate. That makes the picker a single neutral candidate set rather than three
 * scoped ones (see `searchArgs`), and it means the per-kind rules are enforced on
 * submit instead of by hiding candidates.
 *
 * The viewed contact is always written as `contactId`, so `reports_to` means "this
 * person reports to the one you pick" and `succeeds` means "the one you pick is the
 * same human, at a company they've since left". Consequence, accepted: you can't add
 * "X reports to me" from a manager's page — which is what lets the max-one-manager
 * rule be enforced by *omitting the option* rather than surfacing a server rejection.
 *
 * Always rendered `open` by its caller and closed via `onClose`, matching
 * `ProjectRoleDialog`. Edit mode only ever carries a `related` row: the endpoints
 * and the kind are immutable, and the directional kinds have no description, so
 * there'd be nothing to edit — re-pointing is remove + re-add.
 */
export function ContactRelationshipDialog({
  contactId,
  contactName,
  employerCompanyId,
  currentManagerName,
  hasPredecessor,
  existing,
  onClose,
}: {
  /** The page's contact — always the `contactId` end of whatever gets written. */
  contactId: string;
  contactName: string;
  /** Null ⇒ `reports_to` isn't offered (a manager is scoped to an employer). */
  employerCompanyId: string | null;
  /** Non-null ⇒ a manager is already set, so `reports_to` isn't offered. */
  currentManagerName: string | null;
  /** True ⇒ a predecessor is already linked, so `succeeds` isn't offered. */
  hasPredecessor: boolean;
  /** Non-null ⇒ edit mode; only ever a `related` row. */
  existing: EditableContactRelationship | null;
  onClose: () => void;
}) {
  const isEdit = existing !== null;
  const [createOpen, setCreateOpen] = useState(false);

  // Which kinds this contact can actually take right now. Unavailable ones are
  // *omitted* rather than disabled — `EnumSelect` has no disabled-option support,
  // and the reason is better said in the hint line than implied by a dead row.
  const canReportTo = employerCompanyId !== null && currentManagerName === null;
  const availableKinds = useMemo(() => {
    const kinds: ContactRelationshipKind[] = [];
    if (canReportTo) kinds.push("reports_to");
    if (!hasPredecessor) kinds.push("succeeds");
    kinds.push("related");
    return kinds;
  }, [canReportTo, hasPredecessor]);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      kind: isEdit ? "related" : availableKinds[0],
      target: null,
      description: existing?.description ?? "",
    },
  });
  const kind = useWatch({ control, name: "kind" });

  // Both actions revalidate both contact pages, so closing is all we do on success.
  const create = useAction(createContactRelationship, { onSuccess: onClose });
  const update = useAction(updateContactRelationship, { onSuccess: onClose });

  const pending = create.isPending || update.isPending;
  const serverError =
    create.result.serverError ?? update.result.serverError ?? null;

  // One neutral candidate set, deliberately NOT scoped per kind: the contact is
  // chosen *before* the type, so the picker can't know yet what would be valid.
  // It's therefore a superset — everyone but this contact, inactive contacts
  // included (a `succeeds` predecessor is by definition inactive) and always
  // labelled with their employer (every succession candidate shares this
  // person's name, so the company is the only thing telling them apart).
  //
  // The narrower rules — a manager must be a colleague, a predecessor must be at
  // a different company — are enforced by `assertValidContactRelationship` on
  // submit, which returns a specific message. That's the trade for this field
  // order: an invalid pair is caught on save rather than being unofferable.
  //
  // Memoised because `EntityCombobox` re-runs its search whenever `searchArgs`
  // changes identity.
  const searchArgs = useMemo(
    () => ({ excludeId: contactId, includeInactive: true, withCompany: true }),
    [contactId],
  );

  const onSubmit = (values: FormValues) => {
    if (isEdit) {
      const parsed = updateContactRelationshipSchema.safeParse({
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
      setError("target", { message: TARGET_REQUIRED });
      return;
    }

    const parsed = createContactRelationshipSchema.safeParse({
      kind: values.kind,
      contactId,
      relatedContactId: values.target.id,
      // Only `related` carries one; the schema rejects a string on the others.
      description: values.kind === "related" ? values.description : null,
    });
    if (!parsed.success) {
      applyServerIssues(setError, parsed.error, ISSUE_FIELDS);
      return;
    }
    create.execute(parsed.data);
  };

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={isEdit ? "Edit connection" : "Add relationship"}
      description={
        isEdit
          ? "Reword how they know each other. To point this at someone else, remove it and add a new one."
          : "Link this person to another contact — their manager, their earlier record at a previous company, or any other tie."
      }
      contentClassName="sm:max-w-sm"
    >
      {() => (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {/* Contact first, then the type beneath it: you pick the person, then say
              how they relate. The label stays a neutral "Contact" — it can't name
              the role ("Manager") when the type hasn't been chosen yet. */}
          {isEdit ? (
            <FormField label="Contact">
              <Input value={existing.targetName} disabled readOnly />
            </FormField>
          ) : (
            <Controller
              control={control}
              name="target"
              render={({ field }) => (
                <FormField
                  label="Contact"
                  error={errors.target?.message}
                  labelAction={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setCreateOpen(true)}
                    >
                      New contact
                    </Button>
                  }
                >
                  <EntityCombobox
                    value={field.value}
                    onChange={field.onChange}
                    searchAction={searchContacts}
                    searchArgs={searchArgs}
                    placeholder="Search contacts, including inactive…"
                    invalid={Boolean(errors.target)}
                  />
                  {kind === "succeeds" && field.value ? (
                    // This is the one write with a side effect on *another* record,
                    // so say it before submit rather than letting it be discovered.
                    <p className="text-xs text-muted-foreground">
                      {successionSideEffectSentence(field.value.name)}
                    </p>
                  ) : null}
                  <CreateContactInlineDialog
                    open={createOpen}
                    onOpenChange={setCreateOpen}
                    onCreated={field.onChange}
                  />
                </FormField>
              )}
            />
          )}

          {isEdit ? null : (
            <Controller
              control={control}
              name="kind"
              render={({ field }) => (
                <FormField label="Type" error={errors.kind?.message}>
                  <EnumSelect
                    options={availableKinds}
                    labels={CONTACT_RELATIONSHIP_KIND_LABELS}
                    placeholder="Choose a type"
                    value={field.value}
                    // The chosen contact is deliberately KEPT across a type change:
                    // it was picked first, so wiping it would undo the user's last
                    // action. A pair the new type doesn't allow is caught on submit
                    // with a specific message.
                    onValueChange={(next) => {
                      if (next === "") return;
                      field.onChange(next);
                    }}
                    invalid={Boolean(errors.kind)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {CONTACT_RELATIONSHIP_KIND_HINTS[field.value]}
                  </p>
                  {employerCompanyId === null ? (
                    <p className="text-xs text-muted-foreground">
                      {MANAGER_NEEDS_COMPANY_HINT}
                    </p>
                  ) : null}
                  {currentManagerName !== null ? (
                    <p className="text-xs text-muted-foreground">
                      {managerAlreadySetSentence(
                        contactName,
                        currentManagerName,
                      )}
                    </p>
                  ) : null}
                </FormField>
              )}
            />
          )}

          {kind === "related" ? (
            <Controller
              control={control}
              name="description"
              render={({ field }) => (
                <FormField
                  label="How they know each other"
                  htmlFor="contact-relation-description"
                  error={errors.description?.message}
                >
                  <SuggestInput
                    id="contact-relation-description"
                    value={field.value}
                    onChange={field.onChange}
                    suggestions={CONTACT_RELATION_SUGGESTIONS}
                    placeholder="Former colleague"
                    invalid={Boolean(errors.description)}
                  />
                </FormField>
              )}
            />
          ) : null}

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

// One message, not one per kind: the field is now a neutral "Contact" picked
// before the type is chosen, so there's no role to name here.
const TARGET_REQUIRED = "Choose a contact.";
