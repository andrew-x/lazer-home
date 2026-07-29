"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil } from "@tabler/icons-react";
import { useState } from "react";
import { Controller } from "react-hook-form";
import type { ContactDetail } from "@/actions/crm/getContactDetail";
import { updateContact } from "@/actions/crm/updateContact";
import { updateContactSchema } from "@/actions/crm/updateContact.schema";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { contactName } from "@/lib/crm/contact-name";
import {
  contactStatusLabel,
  INACTIVE_BY_SUCCESSION_EXPLANATION,
  INACTIVE_EXPLANATION,
} from "@/lib/crm/contact-status";
import { CompanyComboboxField } from "./company-combobox-field";
import { ContactFields } from "./contact-fields";

/** The "Edit" button + dialog for a contact's fields, employer and status.
 * Owner and relationship strength are edited in place on the page
 * (`InlineOwnerField` / `InlineRelationshipStrengthField`), not here — but both
 * stay in the form defaults so this full-record save round-trips them unchanged.
 *
 * **Status (active/inactive) is edited here**, not inline in the sidebar: it's a
 * deliberate, occasional decision about a person rather than a quick in-place
 * tweak, and it belongs beside the employer it usually changes with. The other
 * writer is `createContactRelationship`, which flips the *predecessor* to inactive
 * when a successor is linked. See `@/lib/crm/contact-status` for what inactive
 * means and why the word isn't "former".
 *
 * There's no manager picker: relationships live on the contact's page.
 * Mirrors `AddContactDialog`'s field layout, seeded from the loaded detail.
 * (Create has no Status field — a brand-new contact is always current.) */
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
      description="Update this contact's details."
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
  // The combobox needs the chosen company's name to display; the form only stores
  // its id, so we track the selected name alongside it, seeded from the detail.
  const [companyName, setCompanyName] = useState<string | null>(
    contact.companyName,
  );

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
          email: contact.email,
          phone: contact.phone ?? "",
          companyId: contact.companyId,
          role: contact.role ?? "",
          linkedinUrl: contact.linkedinUrl ?? "",
          ownerId: contact.ownerId,
          isActive: contact.isActive,
          relationshipStrength: contact.relationshipStrength,
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

      <ContactFields
        idPrefix="edit-contact"
        firstNameField={register("firstName")}
        lastNameField={register("lastName")}
        emailField={register("email")}
        errors={{
          firstName: errors.firstName?.message,
          lastName: errors.lastName?.message,
          email: errors.email?.message,
        }}
      />

      <FormField
        label="Phone (optional)"
        htmlFor="edit-contact-phone"
        error={errors.phone?.message}
      >
        <Input
          id="edit-contact-phone"
          type="tel"
          inputMode="tel"
          placeholder="+1 555 123 4567"
          aria-invalid={Boolean(errors.phone)}
          {...register("phone")}
        />
      </FormField>

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

      <FormField
        label="LinkedIn (optional)"
        htmlFor="edit-contact-linkedin"
        error={errors.linkedinUrl?.message}
      >
        <Input
          id="edit-contact-linkedin"
          inputMode="url"
          placeholder="linkedin.com/in/username"
          aria-invalid={Boolean(errors.linkedinUrl)}
          {...register("linkedinUrl")}
        />
      </FormField>

      <Controller
        control={control}
        name="companyId"
        render={({ field }) => (
          <>
            <CompanyComboboxField
              value={field.value ?? null}
              selectedName={companyName}
              onChange={(next) => {
                field.onChange(next?.id ?? null);
                setCompanyName(next?.name ?? null);
              }}
            />
            {/* A `reports_to` link is only valid between colleagues, so
                `updateContact` drops it when the employer changes. Warn before the
                save rather than after: the old manager picker used to silently
                reset itself on a company switch, and this replaces that. */}
            {contact.manager !== null && field.value !== contact.companyId ? (
              <p className="text-xs text-muted-foreground">
                Changing the company will clear who {contactName(contact)}{" "}
                reports to.
              </p>
            ) : null}
          </>
        )}
      />

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

      {/* Owner is edited inline on the page, not here. `ownerId` stays in the
          form defaults with no field of its own, so RHF submits the current
          value untouched — this full-record save must not clear it. */}

      <FormDialogFooter
        serverError={action.result.serverError}
        submitLabel="Save"
        loading={action.isPending}
      />
    </form>
  );
}
