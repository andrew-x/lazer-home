"use client";

import { IconPlus } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { Controller, useForm } from "react-hook-form";
import { createOpportunity } from "@/actions/crm/createOpportunity";
import {
  type CreateOpportunityInput,
  createOpportunitySchema,
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STATUSES,
  type OpportunitySource,
  type OpportunityStatus,
} from "@/actions/crm/createOpportunity.schema";
import { searchStaff } from "@/actions/crm/searchStaff";
import { EnumSelect } from "@/components/form/enum-select";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CompanyComboboxField } from "./company-combobox-field";
import { ContactsComboboxField } from "./contacts-combobox-field";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "./entity-multi-combobox";
import { SOURCE_LABELS, STATUS_LABELS } from "./opportunity-display";

type OpportunityFormValues = {
  name: string;
  companyId: string;
  companyName: string;
  contacts: EntityOption[];
  owners: EntityOption[];
  source: OpportunitySource | "";
  sourceContacts: EntityOption[];
  sourceStaff: EntityOption[];
  nextSteps: string;
  status: OpportunityStatus | "";
};

const DEFAULT_VALUES: OpportunityFormValues = {
  name: "",
  companyId: "",
  companyName: "",
  contacts: [],
  owners: [],
  source: "",
  sourceContacts: [],
  sourceStaff: [],
  nextSteps: "",
  status: "",
};

// Maps a server-schema issue path to the corresponding form field. Typed by
// `keyof CreateOpportunityInput` so tsc forces an entry for every schema field —
// a new field can't silently drop its server errors.
const FIELD_FOR_ISSUE: Record<
  keyof CreateOpportunityInput,
  keyof OpportunityFormValues
> = {
  name: "name",
  companyId: "companyId",
  contactIds: "contacts",
  ownerIds: "owners",
  source: "source",
  sourceContactIds: "sourceContacts",
  sourceStaffIds: "sourceStaff",
  nextSteps: "nextSteps",
  status: "status",
};

export function AddOpportunityDialog() {
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <IconPlus />
          Add opportunity
        </Button>
      }
      title="Add opportunity"
      description="Create a pipeline deal for a company."
      contentClassName="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
    >
      {({ close }) => <OpportunityForm onSaved={close} />}
    </FormDialog>
  );
}

function OpportunityForm({ onSaved }: { onSaved: () => void }) {
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm<OpportunityFormValues>({ defaultValues: DEFAULT_VALUES });

  const { execute, result, isPending } = useAction(createOpportunity, {
    onSuccess: () => onSaved(),
  });

  const source = watch("source");
  const companyName = watch("companyName");

  const onSubmit = (values: OpportunityFormValues) => {
    clearErrors();
    const payload = {
      name: values.name,
      companyId: values.companyId,
      contactIds: values.contacts.map((c) => c.id),
      ownerIds: values.owners.map((o) => o.id),
      source: values.source,
      sourceContactIds: values.sourceContacts.map((c) => c.id),
      sourceStaffIds: values.sourceStaff.map((s) => s.id),
      nextSteps: values.nextSteps,
      status: values.status,
    };

    const parsed = createOpportunitySchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        const field =
          typeof key === "string" && key in FIELD_FOR_ISSUE
            ? FIELD_FOR_ISSUE[key as keyof CreateOpportunityInput]
            : undefined;
        if (field) setError(field, { message: issue.message });
      }
      return;
    }

    execute(parsed.data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <FormField label="Name" htmlFor="opp-name" error={errors.name?.message}>
        <Input
          id="opp-name"
          placeholder="Acme platform rebuild"
          aria-invalid={Boolean(errors.name)}
          {...register("name")}
        />
      </FormField>

      <Controller
        control={control}
        name="companyId"
        render={({ field }) => (
          <CompanyComboboxField
            value={field.value || null}
            selectedName={companyName || null}
            onChange={(next) => {
              field.onChange(next?.id ?? "");
              setValue("companyName", next?.name ?? "");
              if (next) clearErrors("companyId");
            }}
            error={errors.companyId?.message}
          />
        )}
      />

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
              labels={STATUS_LABELS}
              placeholder="Select a status"
              value={field.value}
              invalid={Boolean(fieldState.error)}
              onValueChange={field.onChange}
            />
          )}
        />
      </FormField>

      <FormField label="Next steps" htmlFor="opp-next-steps">
        <Textarea
          id="opp-next-steps"
          placeholder="What happens next?"
          {...register("nextSteps")}
        />
      </FormField>

      <FormDialogFooter
        serverError={result.serverError}
        submitLabel="Save"
        loading={isPending}
      />
    </form>
  );
}
