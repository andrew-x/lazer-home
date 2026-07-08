"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { Controller } from "react-hook-form";
import { createCompany } from "@/actions/crm/createCompany";
import { createCompanySchema } from "@/actions/crm/createCompany.schema";
import type { EntityOption } from "@/components/crm/entity-multi-combobox";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { CompanyFields } from "./company-fields";

/**
 * A create-company dialog for inline use inside the opportunity form. Persists
 * the company via `createCompany` and hands the new `{ id, name }` back so the
 * caller can select it.
 */
export function CreateCompanyInlineDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (option: EntityOption) => void;
}) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New company"
      description="Create a company for this opportunity."
      contentClassName="sm:max-w-sm"
      forceMountOverlay
    >
      {({ close }) => (
        <InlineCompanyForm
          onCreated={(option) => {
            onCreated(option);
            close();
          }}
        />
      )}
    </FormDialog>
  );
}

function InlineCompanyForm({
  onCreated,
}: {
  onCreated: (option: EntityOption) => void;
}) {
  const { form, action, handleSubmitWithAction } = useHookFormAction(
    createCompany,
    zodResolver(createCompanySchema),
    {
      actionProps: {
        onSuccess: ({ data }) => {
          if (!data?.id) return;
          onCreated({ id: data.id, name: form.getValues("name") });
        },
      },
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
    <form
      // This form is portaled but remains a React descendant of the form that
      // opened it, so its submit would bubble and validate the parent form.
      // Stop it at the boundary.
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleSubmitWithAction(e);
      }}
      className="flex flex-col gap-4"
    >
      <Controller
        control={control}
        name="isPartner"
        render={({ field }) => (
          <CompanyFields
            idPrefix="inline-company"
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
        submitLabel="Create company"
        loading={action.isPending}
      />
    </form>
  );
}
