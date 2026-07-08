"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPlus } from "@tabler/icons-react";
import { Controller } from "react-hook-form";
import { createCompany } from "@/actions/crm/createCompany";
import { createCompanySchema } from "@/actions/crm/createCompany.schema";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { Button } from "@/components/ui/button";
import { CompanyFields } from "./company-fields";

export function AddCompanyDialog() {
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <IconPlus />
          Add company
        </Button>
      }
      title="Add company"
      description="Create a new company."
    >
      {({ close }) => <CompanyForm onSaved={close} />}
    </FormDialog>
  );
}

function CompanyForm({ onSaved }: { onSaved: () => void }) {
  const { form, action, handleSubmitWithAction } = useHookFormAction(
    createCompany,
    zodResolver(createCompanySchema),
    {
      actionProps: { onSuccess: () => onSaved() },
      formProps: {
        defaultValues: { name: "", websiteUrl: "", isPartner: false },
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
      <Controller
        control={control}
        name="isPartner"
        render={({ field }) => (
          <CompanyFields
            idPrefix="company"
            nameField={register("name")}
            websiteField={register("websiteUrl")}
            isPartner={field.value ?? false}
            onPartnerChange={field.onChange}
            errors={{
              name: errors.name?.message,
              websiteUrl: errors.websiteUrl?.message,
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
