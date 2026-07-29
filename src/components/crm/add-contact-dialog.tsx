"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { Controller } from "react-hook-form";
import { createContact } from "@/actions/crm/createContact";
import { createContactSchema } from "@/actions/crm/createContact.schema";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompanyComboboxField } from "./company-combobox-field";
import { ContactFields } from "./contact-fields";

export function AddContactDialog() {
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <IconPlus />
          Add contact
        </Button>
      }
      title="Add contact"
      description="Create a new contact, optionally linked to a company."
    >
      {({ close }) => <ContactForm onSaved={close} />}
    </FormDialog>
  );
}

/**
 * The create-contact form. Deliberately has **no manager picker**: every
 * person-to-person link is a `contact_relationships` row now, added from the
 * contact's own page once it exists (see `ContactRelationshipsSection`).
 */
function ContactForm({ onSaved }: { onSaved: () => void }) {
  // The combobox needs the chosen company's name to display; the form only stores
  // its id, so we track the selected name alongside it here.
  const [companyName, setCompanyName] = useState<string | null>(null);

  const { form, action, handleSubmitWithAction } = useHookFormAction(
    createContact,
    zodResolver(createContactSchema),
    {
      actionProps: { onSuccess: () => onSaved() },
      formProps: {
        defaultValues: {
          firstName: "",
          lastName: "",
          email: "",
          phone: "",
          companyId: null,
          role: "",
          linkedinUrl: "",
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
      <ContactFields
        idPrefix="contact"
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
        htmlFor="contact-phone"
        error={errors.phone?.message}
      >
        <Input
          id="contact-phone"
          type="tel"
          inputMode="tel"
          placeholder="+1 555 123 4567"
          aria-invalid={Boolean(errors.phone)}
          {...register("phone")}
        />
      </FormField>

      <FormField
        label="Role"
        htmlFor="contact-role"
        error={errors.role?.message}
      >
        <Input
          id="contact-role"
          placeholder="CTO"
          aria-invalid={Boolean(errors.role)}
          {...register("role")}
        />
      </FormField>

      <FormField
        label="LinkedIn (optional)"
        htmlFor="contact-linkedin"
        error={errors.linkedinUrl?.message}
      >
        <Input
          id="contact-linkedin"
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
            }}
          />
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
