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

function ContactForm({ onSaved }: { onSaved: () => void }) {
  // The combobox needs the company's name to display; the form only stores the
  // id, so we track the chosen name alongside it here.
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
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="First name"
          htmlFor="contact-first"
          error={errors.firstName?.message}
        >
          <Input
            id="contact-first"
            aria-invalid={Boolean(errors.firstName)}
            {...register("firstName")}
          />
        </FormField>
        <FormField
          label="Last name"
          htmlFor="contact-last"
          error={errors.lastName?.message}
        >
          <Input
            id="contact-last"
            aria-invalid={Boolean(errors.lastName)}
            {...register("lastName")}
          />
        </FormField>
      </div>

      <FormField
        label="Email"
        htmlFor="contact-email"
        error={errors.email?.message}
      >
        <Input
          id="contact-email"
          type="email"
          placeholder="person@company.com"
          aria-invalid={Boolean(errors.email)}
          {...register("email")}
        />
      </FormField>

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
