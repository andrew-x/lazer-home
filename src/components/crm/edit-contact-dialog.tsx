"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil } from "@tabler/icons-react";
import { useState } from "react";
import { Controller, useWatch } from "react-hook-form";
import type { ContactDetail } from "@/actions/crm/getContactDetail";
import { updateContact } from "@/actions/crm/updateContact";
import { updateContactSchema } from "@/actions/crm/updateContact.schema";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompanyComboboxField } from "./company-combobox-field";
import { ContactFields } from "./contact-fields";
import { ManagerComboboxField } from "./manager-combobox-field";

/** The "Edit" button + dialog for a contact's fields, employer and manager.
 * Owner is edited in place on the page (`InlineOwnerField`), not here — but
 * `ownerId` stays in the form defaults so this full-record save round-trips it
 * unchanged. Mirrors `AddContactDialog` (same field layout and the same
 * company→manager dependency), seeded from the loaded detail. */
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
  // The comboboxes need the chosen entity's name to display; the form only
  // stores ids, so we track the selected company/manager/owner names alongside
  // them, seeded from the loaded detail.
  const [companyName, setCompanyName] = useState<string | null>(
    contact.companyName,
  );
  const [managerName, setManagerName] = useState<string | null>(
    contact.managerName,
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
          managerId: contact.managerId,
          ownerId: contact.ownerId,
        },
      },
    },
  );

  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = form;

  // `useWatch` (rather than `form.watch`) so the manager field reliably
  // re-renders when the company changes — it appears only once a company is set.
  const companyId = useWatch({ control, name: "companyId" });

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
          <CompanyComboboxField
            value={field.value ?? null}
            selectedName={companyName}
            onChange={(next) => {
              field.onChange(next?.id ?? null);
              setCompanyName(next?.name ?? null);
              // A manager is a colleague at the chosen company, so a company
              // change invalidates any prior manager selection.
              setValue("managerId", null);
              setManagerName(null);
            }}
          />
        )}
      />

      {companyId ? (
        <Controller
          control={control}
          name="managerId"
          render={({ field }) => (
            <ManagerComboboxField
              // Remount when the company changes so the picker's search state
              // can't linger with the previous company's contacts.
              key={companyId}
              companyId={companyId}
              value={field.value ?? null}
              selectedName={managerName}
              onChange={(next) => {
                field.onChange(next?.id ?? null);
                setManagerName(next?.name ?? null);
              }}
            />
          )}
        />
      ) : null}

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
