"use client";

import type { ReactNode } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { searchStaff } from "@/actions/crm/searchStaff";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "@/components/form/entity-multi-combobox";
import { EnumSelect } from "@/components/form/enum-select";
import { FormField } from "@/components/form/form-field";
import { Input } from "@/components/ui/input";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_LABELS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import {
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STATUSES,
  type OpportunitySource,
  type OpportunityStatus,
  SOURCE_LABELS,
} from "@/lib/crm/opportunity";
import { ContactsComboboxField } from "./contacts-combobox-field";
import { STATUS_SELECT_LABELS } from "./opportunity-display";

/**
 * The react-hook-form value shape for the add-opportunity dialog's fields. The
 * dialog's form is a superset — it adds `companyId`/`companyName` for its company
 * picker — which is why `OpportunityFields` below is generic over the caller's
 * form type. Keeping the field UI, the values→input mapper, and the server-issue
 * field map together here means they can't drift — mirrors how `CompanyFields`
 * serves the add + inline company forms.
 *
 * The add-opportunity dialog is the sole caller: the detail drawer edits each
 * field inline (`opportunity-detail-sheet.tsx`) and does not use this component.
 */
export type OpportunityFieldValues = {
  name: string;
  lineOfBusiness: LineOfBusiness | "";
  contacts: EntityOption[];
  owners: EntityOption[];
  source: OpportunitySource | "";
  sourceContacts: EntityOption[];
  sourceStaff: EntityOption[];
  status: OpportunityStatus | "";
};

/**
 * Maps the shared form values to the common slice of the create/update action
 * input. Callers spread the result and add their key (`companyId` on create,
 * `id` on update) before parsing.
 */
export function opportunityValuesToInput(values: OpportunityFieldValues) {
  return {
    name: values.name,
    lineOfBusiness: values.lineOfBusiness,
    contactIds: values.contacts.map((c) => c.id),
    ownerIds: values.owners.map((o) => o.id),
    source: values.source,
    sourceContactIds: values.sourceContacts.map((c) => c.id),
    sourceStaffIds: values.sourceStaff.map((s) => s.id),
    status: values.status,
  };
}

/**
 * Base map from a server-schema issue path to its form field, covering the
 * fields the create schema shares with this form. The add dialog spreads this
 * and adds its own key (`companyId` → the company field), typing the final
 * object by `keyof CreateOpportunityInput` so a new schema field can't silently
 * drop its errors.
 */
export const OPPORTUNITY_FIELD_FOR_ISSUE = {
  name: "name",
  lineOfBusiness: "lineOfBusiness",
  contactIds: "contacts",
  ownerIds: "owners",
  source: "source",
  sourceContactIds: "sourceContacts",
  sourceStaffIds: "sourceStaff",
  status: "status",
} satisfies Record<string, keyof OpportunityFieldValues>;

/**
 * The add-opportunity dialog's form fields. Generic over the caller's form type
 * only to bridge react-hook-form's invariance: the dialog's form is a superset
 * (it adds `companyId`/`companyName`), and `UseFormReturn` isn't assignable
 * across differing value shapes, so the prop is widened here and narrowed once
 * internally to the shared shape these controls actually bind. `companySlot` is
 * rendered just after the name field — the dialog passes its company picker
 * there. `idPrefix` keeps element ids unique across instances.
 */
export function OpportunityFields<TValues extends OpportunityFieldValues>({
  form,
  idPrefix,
  companySlot,
}: {
  form: UseFormReturn<TValues>;
  idPrefix: string;
  companySlot?: ReactNode;
}) {
  // Narrow once: the sole caller passes a superset form (it adds company
  // fields), but every control below binds only the shared `OpportunityFieldValues`.
  const {
    register,
    control,
    setValue,
    clearErrors,
    watch,
    formState: { errors },
  } = form as unknown as UseFormReturn<OpportunityFieldValues>;

  const source = watch("source");

  return (
    <>
      <FormField
        label="Name"
        htmlFor={`${idPrefix}-name`}
        error={errors.name?.message}
      >
        <Input
          id={`${idPrefix}-name`}
          placeholder="Acme platform rebuild"
          aria-invalid={Boolean(errors.name)}
          {...register("name")}
        />
      </FormField>

      <FormField
        label="Line of business"
        error={errors.lineOfBusiness?.message}
      >
        <Controller
          control={control}
          name="lineOfBusiness"
          render={({ field, fieldState }) => (
            <EnumSelect
              options={LINE_OF_BUSINESS}
              labels={LINE_OF_BUSINESS_LABELS}
              placeholder="Select a line of business"
              value={field.value}
              invalid={Boolean(fieldState.error)}
              onValueChange={field.onChange}
            />
          )}
        />
      </FormField>

      {companySlot}

      <Controller
        control={control}
        name="contacts"
        render={({ field, fieldState }) => (
          <ContactsComboboxField
            label="Contacts"
            value={field.value}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />

      <FormField label="Owners">
        <Controller
          control={control}
          name="owners"
          render={({ field, fieldState }) => (
            <EntityMultiCombobox
              value={field.value}
              onChange={field.onChange}
              searchAction={searchStaff}
              placeholder="Search staff…"
              invalid={Boolean(fieldState.error)}
            />
          )}
        />
      </FormField>

      <FormField label="Source" error={errors.source?.message}>
        <Controller
          control={control}
          name="source"
          render={({ field, fieldState }) => (
            <EnumSelect
              options={OPPORTUNITY_SOURCES}
              labels={SOURCE_LABELS}
              placeholder="Select a source"
              value={field.value}
              invalid={Boolean(fieldState.error)}
              onValueChange={(next) => {
                field.onChange(next);
                // Referral entities only apply to their matching source.
                setValue("sourceStaff", []);
                setValue("sourceContacts", []);
                clearErrors(["sourceStaff", "sourceContacts"]);
              }}
            />
          )}
        />
      </FormField>

      {source === "staff_referral" ? (
        <FormField label="Referring staff" error={errors.sourceStaff?.message}>
          <Controller
            control={control}
            name="sourceStaff"
            render={({ field, fieldState }) => (
              <EntityMultiCombobox
                value={field.value}
                onChange={field.onChange}
                searchAction={searchStaff}
                placeholder="Search staff…"
                invalid={Boolean(fieldState.error)}
              />
            )}
          />
        </FormField>
      ) : null}

      {source === "contact_referral" ? (
        <Controller
          control={control}
          name="sourceContacts"
          render={({ field, fieldState }) => (
            <ContactsComboboxField
              label="Referring contacts"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
      ) : null}

      <FormField label="Status" error={errors.status?.message}>
        <Controller
          control={control}
          name="status"
          render={({ field, fieldState }) => (
            <EnumSelect
              options={OPPORTUNITY_STATUSES}
              labels={STATUS_SELECT_LABELS}
              placeholder="Select a status"
              value={field.value}
              invalid={Boolean(fieldState.error)}
              onValueChange={field.onChange}
            />
          )}
        />
      </FormField>
    </>
  );
}
