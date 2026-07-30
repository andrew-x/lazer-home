"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil } from "@tabler/icons-react";
import { Controller } from "react-hook-form";
import type { ContactDetail } from "@/actions/crm/getContactDetail";
import { updateContact } from "@/actions/crm/updateContact";
import { updateContactSchema } from "@/actions/crm/updateContact.schema";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  contactStatusLabel,
  INACTIVE_BY_SUCCESSION_EXPLANATION,
  INACTIVE_EXPLANATION,
} from "@/lib/crm/contact-status";
import { ContactNameFields } from "./contact-fields";

/** The "Edit" button + dialog for a contact's identity: their name, job title and
 * active/inactive status.
 *
 * Deliberately *not* the whole record. Everything else — email, phone, LinkedIn,
 * employer, location, owner, relationship strength — is edited in place in the
 * sidebar (`ContactDetailView`), because those are single facts you correct in
 * passing, and a one-field save can't clobber a concurrent edit the way a
 * full-record dialog can. What's left here is the identity block: the fields you'd
 * change together, as one deliberate decision about a person.
 *
 * **Status (active/inactive) is one of them** rather than an inline row: it's an
 * occasional judgement call, not a quick tweak. The other writer is
 * `createContactRelationship`, which flips the *predecessor* to inactive when a
 * successor is linked. See `@/lib/crm/contact-status` for what inactive means and
 * why the word isn't "former".
 *
 * There's no manager picker: relationships live on the contact's page. Unlike
 * `AddContactDialog` — which still captures email/phone/company up front, since a
 * new contact you can't reach isn't much use — this shares only the name fields. */
export function EditContactDialog({ contact }: { contact: ContactDetail }) {
  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="sm">
          <IconPencil />
          Edit
        </Button>
      }
      title="Edit contact"
      description="Update this contact's name, role and status."
    >
      {({ close }) => <ContactForm contact={contact} onSaved={close} />}
    </FormDialog>
  );
}

function ContactForm({
  contact,
  onSaved,
}: {
  contact: ContactDetail;
  onSaved: () => void;
}) {
  const { form, action, handleSubmitWithAction } = useHookFormAction(
    updateContact,
    zodResolver(updateContactSchema),
    {
      actionProps: { onSuccess: () => onSaved() },
      formProps: {
        defaultValues: {
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          role: contact.role ?? "",
          isActive: contact.isActive,
        },
      },
    },
  );

  const {
    register,
    control,
    formState: { errors },
  } = form;

  return (
    <form onSubmit={handleSubmitWithAction} className="flex flex-col gap-4">
      <input type="hidden" {...register("id")} />

      <ContactNameFields
        idPrefix="edit-contact"
        firstNameField={register("firstName")}
        lastNameField={register("lastName")}
        errors={{
          firstName: errors.firstName?.message,
          lastName: errors.lastName?.message,
        }}
      />

      <FormField
        label="Role"
        htmlFor="edit-contact-role"
        error={errors.role?.message}
      >
        <Input
          id="edit-contact-role"
          placeholder="CTO"
          aria-invalid={Boolean(errors.role)}
          {...register("role")}
        />
      </FormField>

      <Controller
        control={control}
        name="isActive"
        render={({ field }) => (
          <FormField label="Status" error={errors.isActive?.message}>
            <div className="flex h-9 items-center gap-2 text-sm">
              <Switch
                id="edit-contact-active"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
              <label htmlFor="edit-contact-active">
                {contactStatusLabel(field.value)}
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              {contact.successor
                ? // When a succession set this, we know the reason — say it, or
                  // switching it back looks like the obvious fix for a record that
                  // only appears wrong.
                  INACTIVE_BY_SUCCESSION_EXPLANATION
                : INACTIVE_EXPLANATION}
            </p>
          </FormField>
        )}
      />

      <FormDialogFooter
        serverError={action.result.serverError}
        submitLabel="Save"
        loading={action.isPending}
      />
    </form>
  );
}
