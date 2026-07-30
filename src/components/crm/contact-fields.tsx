"use client";

import type { UseFormRegisterReturn } from "react-hook-form";
import { FormField } from "@/components/form/form-field";
import { Input } from "@/components/ui/input";

/**
 * The first/last name grid, on its own because the create and edit forms need
 * different amounts around it: create captures the contact methods too (a new
 * contact you can't reach isn't much use), whereas the edit dialog is down to the
 * identity block — email and the rest are edited inline on the detail page.
 *
 * Text inputs are wired through react-hook-form's `register` (Base UI's `Input`
 * is uncontrolled here). `idPrefix` keeps element ids unique when more than one
 * instance is mounted.
 */
export function ContactNameFields({
  idPrefix,
  firstNameField,
  lastNameField,
  errors,
}: {
  idPrefix: string;
  firstNameField: UseFormRegisterReturn;
  lastNameField: UseFormRegisterReturn;
  errors?: { firstName?: string; lastName?: string };
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FormField
        label="First name"
        htmlFor={`${idPrefix}-first`}
        error={errors?.firstName}
      >
        <Input
          id={`${idPrefix}-first`}
          aria-invalid={Boolean(errors?.firstName)}
          {...firstNameField}
        />
      </FormField>
      <FormField
        label="Last name"
        htmlFor={`${idPrefix}-last`}
        error={errors?.lastName}
      >
        <Input
          id={`${idPrefix}-last`}
          aria-invalid={Boolean(errors?.lastName)}
          {...lastNameField}
        />
      </FormField>
    </div>
  );
}

/**
 * The core contact identity fields for **creating** a contact: the name grid plus
 * email. Shared between the standalone Add-contact dialog and the inline
 * create-contact flow so both stay identical; the full dialog renders
 * phone/role/linkedin/company below this. Mirrors `CompanyFields`.
 */
export function ContactFields({
  idPrefix,
  firstNameField,
  lastNameField,
  emailField,
  errors,
}: {
  idPrefix: string;
  firstNameField: UseFormRegisterReturn;
  lastNameField: UseFormRegisterReturn;
  emailField: UseFormRegisterReturn;
  errors?: { firstName?: string; lastName?: string; email?: string };
}) {
  return (
    <>
      <ContactNameFields
        idPrefix={idPrefix}
        firstNameField={firstNameField}
        lastNameField={lastNameField}
        errors={errors}
      />

      <FormField
        label="Email"
        htmlFor={`${idPrefix}-email`}
        error={errors?.email}
      >
        <Input
          id={`${idPrefix}-email`}
          type="email"
          placeholder="person@company.com"
          aria-invalid={Boolean(errors?.email)}
          {...emailField}
        />
      </FormField>
    </>
  );
}
