"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil } from "@tabler/icons-react";
import { Controller } from "react-hook-form";
import type { CompanyDetail } from "@/actions/crm/getCompanyDetail";
import { updateCompany } from "@/actions/crm/updateCompany";
import { updateCompanySchema } from "@/actions/crm/updateCompany.schema";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { Button } from "@/components/ui/button";
import { CompanyFields } from "./company-fields";

/** The "Edit" button + dialog for a company's core fields. Owner is edited in
 * place on the page (`InlineOwnerField`), not here — but `ownerId` stays in the
 * form defaults so this full-record save round-trips it unchanged. Mirrors
 * `AddCompanyDialog`, reusing `CompanyFields` so add and edit stay identical. */
export function EditCompanyDialog({ company }: { company: CompanyDetail }) {
  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="sm">
          <IconPencil />
          Edit
        </Button>
      }
      title="Edit company"
      description="Update this company's details."
    >
      {({ close }) => <CompanyForm company={company} onSaved={close} />}
    </FormDialog>
  );
}

function CompanyForm({
  company,
  onSaved,
}: {
  company: CompanyDetail;
  onSaved: () => void;
}) {
  const { form, action, handleSubmitWithAction } = useHookFormAction(
    updateCompany,
    zodResolver(updateCompanySchema),
    {
      actionProps: { onSuccess: () => onSaved() },
      formProps: {
        defaultValues: {
          id: company.id,
          name: company.name,
          websiteUrl: company.websiteUrl ?? "",
          isPartner: company.isPartner,
          ownerId: company.ownerId,
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
      <input type="hidden" {...register("id")} />

      <Controller
        control={control}
        name="isPartner"
        render={({ field }) => (
          <CompanyFields
            idPrefix="edit-company"
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

      {/* Owner is edited inline on the page, not here. `ownerId` stays in the
          form defaults with no field of its own, so RHF submits the current
          value untouched — this full-record save must not clear it. */}

      <FormDialogFooter
        serverError={action.result.serverError}
        submitLabel="Save"
        loading={action.isPending}
      />
    </form>
  );
}
