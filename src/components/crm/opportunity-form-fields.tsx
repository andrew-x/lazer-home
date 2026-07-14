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
import { Textarea } from "@/components/ui/textarea";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_LABELS,
  type LineOfBusiness,
} from "@/lib/line-of-business";
import {
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STATUSES,
  type OpportunitySource,
  type OpportunityStatus,
  SOURCE_LABELS,
} from "@/lib/opportunity";
import { ContactsComboboxField } from "./contacts-combobox-field";
import { STATUS_SELECT_LABELS } from "./opportunity-display";

/**
 * The react-hook-form value shape shared by the add-opportunity dialog and the
 * detail-drawer edit form. The add form extends it with `companyId`/`companyName`
 * (company isn't editable in the drawer); both bind these fields identically, so
 * the field UI, the values→input mapper, and the server-issue field map all live
 * here and can't drift — mirrors how `CompanyFields` serves the add + inline
 * company forms.
 */
export type OpportunityFieldValues = {
  name: string;
  lineOfBusiness: LineOfBusiness | "";
  contacts: EntityOption[];
  owners: EntityOption[];
  source: OpportunitySource | "";
  sourceContacts: EntityOption[];
  sourceStaff: EntityOption[];
  nextSteps: string;
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
    nextSteps: values.nextSteps,
    status: values.status,
  };
}

/**
 * Base map from a server-schema issue path to its form field, covering the
 * fields both schemas share. Each dialog spreads this and adds its own key
 * (`companyId` → company field on create; `id` → `name` fallback on update),
 * typing the final object by `keyof <Schema>Input` so a new schema field can't
 * silently drop its errors.
 */
export const OPPORTUNITY_FIELD_FOR_ISSUE = {
  name: "name",
  lineOfBusiness: "lineOfBusiness",
  contactIds: "contacts",
  ownerIds: "owners",
  source: "source",
  sourceContactIds: "sourceContacts",
  sourceStaffIds: "sourceStaff",
  nextSteps: "nextSteps",
  status: "status",
} satisfies Record<string, keyof OpportunityFieldValues>;

/**
 * The shared opportunity form fields. Generic over the caller's form type (which
 * may extend `OpportunityFieldValues`); internally narrowed to the shared shape,
 * since these controls only touch the shared fields. `companySlot` is rendered
 * just after the name field — the add dialog passes its company picker there; the
 * edit drawer omits it. `idPrefix` keeps element ids unique across instances.
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
  // Narrow once: callers may pass a superset form (create adds company fields),
  // but every control below binds only the shared `OpportunityFieldValues`.
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

      {companySlot}

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

      <FormField label="Next steps" htmlFor={`${idPrefix}-next-steps`}>
        <Textarea
          id={`${idPrefix}-next-steps`}
          placeholder="What happens next?"
          {...register("nextSteps")}
        />
      </FormField>
    </>
  );
}
