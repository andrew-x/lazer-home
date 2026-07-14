"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { Controller, useWatch } from "react-hook-form";
import { createContact } from "@/actions/crm/createContact";
import { createContactSchema } from "@/actions/crm/createContact.schema";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompanyComboboxField } from "./company-combobox-field";
import { ContactFields } from "./contact-fields";
import { ManagerComboboxField } from "./manager-combobox-field";

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
  // The comboboxes need the chosen entity's name to display; the form only stores
  // ids, so we track the selected company/manager names alongside them here.
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [managerName, setManagerName] = useState<string | null>(null);

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
          managerId: null,
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

  // `useWatch` (rather than `form.watch`) so the manager field reliably re-renders
  // when the company changes — it appears only once a company is chosen.
  const companyId = useWatch({ control, name: "companyId" });

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
              // can't linger with the previous company's contacts (managerId is
              // cleared alongside, so there's nothing to preserve across a switch).
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

      <FormDialogFooter
        serverError={action.result.serverError}
        submitLabel="Save"
        loading={action.isPending}
      />
    </form>
  );
}
