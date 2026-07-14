"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil } from "@tabler/icons-react";
import { useState } from "react";
import { Controller } from "react-hook-form";
import type { CompanyDetail } from "@/actions/crm/getCompanyDetail";
import { updateCompany } from "@/actions/crm/updateCompany";
import { updateCompanySchema } from "@/actions/crm/updateCompany.schema";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { Button } from "@/components/ui/button";
import { CompanyFields } from "./company-fields";
import { OwnerComboboxField } from "./owner-combobox-field";

/** The "Edit" button + dialog for a company's core fields and owner. Mirrors
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
  // The owner combobox needs the chosen staff member's name to display; the
  // form only stores the id, so we track the selected owner name alongside it.
  const [ownerName, setOwnerName] = useState<string | null>(company.ownerName);

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

      <Controller
        control={control}
        name="ownerId"
        render={({ field }) => (
          <OwnerComboboxField
            value={field.value ?? null}
            selectedName={ownerName}
            onChange={(next) => {
              field.onChange(next?.id ?? null);
              setOwnerName(next?.name ?? null);
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
