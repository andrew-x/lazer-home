"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { Controller } from "react-hook-form";
import { createCompany } from "@/actions/crm/createCompany";
import { createCompanySchema } from "@/actions/crm/createCompany.schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CompanyFields } from "./company-fields";

export function AddCompanyDialog() {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setFormKey((k) => k + 1);
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm">
            <IconPlus />
            Add company
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add company</DialogTitle>
          <DialogDescription>Create a new company.</DialogDescription>
        </DialogHeader>
        <CompanyForm key={formKey} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
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

      {action.result.serverError ? (
        <p className="text-sm text-destructive">{action.result.serverError}</p>
      ) : null}

      <DialogFooter>
        <DialogClose
          render={
            <Button type="button" variant="outline">
              Cancel
            </Button>
          }
        />
        <Button type="submit" loading={action.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
