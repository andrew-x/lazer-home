"use client";

import { IconPlus } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { Controller, useForm } from "react-hook-form";
import { createOpportunity } from "@/actions/crm/createOpportunity";
import {
  type CreateOpportunityInput,
  createOpportunitySchema,
} from "@/actions/crm/createOpportunity.schema";
import { applyServerIssues } from "@/components/form/apply-server-issues";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { Button } from "@/components/ui/button";
import { CompanyComboboxField } from "./company-combobox-field";
import {
  OPPORTUNITY_FIELD_FOR_ISSUE,
  OpportunityFields,
  type OpportunityFieldValues,
  opportunityValuesToInput,
} from "./opportunity-form-fields";

type OpportunityFormValues = OpportunityFieldValues & {
  companyId: string;
  companyName: string;
};

const DEFAULT_VALUES: OpportunityFormValues = {
  name: "",
  companyId: "",
  companyName: "",
  lineOfBusiness: "",
  contacts: [],
  owners: [],
  source: "",
  sourceContacts: [],
  sourceStaff: [],
  status: "lead",
};

// Base map plus the create-only `companyId`. Typed by `keyof
// CreateOpportunityInput` so tsc forces an entry for every schema field — a new
// field can't silently drop its server errors.
const FIELD_FOR_ISSUE: Record<
  keyof CreateOpportunityInput,
  keyof OpportunityFormValues
> = {
  ...OPPORTUNITY_FIELD_FOR_ISSUE,
  companyId: "companyId",
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
  const form = useForm<OpportunityFormValues>({
    defaultValues: DEFAULT_VALUES,
  });
  const {
    control,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    watch,
    formState: { errors },
  } = form;

  const { execute, result, isPending } = useAction(createOpportunity, {
    onSuccess: () => onSaved(),
  });

  const companyName = watch("companyName");

  const onSubmit = (values: OpportunityFormValues) => {
    clearErrors();
    const payload = {
      ...opportunityValuesToInput(values),
      companyId: values.companyId,
    };

    const parsed = createOpportunitySchema.safeParse(payload);
    if (!parsed.success) {
      applyServerIssues(setError, parsed.error, FIELD_FOR_ISSUE);
      return;
    }

    execute(parsed.data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <OpportunityFields
        form={form}
        idPrefix="opp"
        companySlot={
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
        }
      />

      <FormDialogFooter
        serverError={result.serverError}
        submitLabel="Save"
        loading={isPending}
      />
    </form>
  );
}
