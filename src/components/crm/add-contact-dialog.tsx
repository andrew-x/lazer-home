"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { Controller } from "react-hook-form";
import { createContact } from "@/actions/crm/createContact";
import { createContactSchema } from "@/actions/crm/createContact.schema";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CompanyCombobox } from "./company-combobox";
import { CompanyFields, type CompanyFieldValues } from "./company-fields";

const EMPTY_COMPANY: CompanyFieldValues = {
  name: "",
  websiteUrl: "",
  isPartner: false,
};

export function AddContactDialog() {
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
            Add contact
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add contact</DialogTitle>
          <DialogDescription>
            Create a new contact, optionally linked to a company.
          </DialogDescription>
        </DialogHeader>
        <ContactForm key={formKey} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ContactForm({ onSaved }: { onSaved: () => void }) {
  // The combobox needs the company's name to display; the form only stores the
  // id, so we track the chosen name alongside it here.
  const [companyName, setCompanyName] = useState<string | null>(null);
  // Whether the company section is creating a new company inline. The new
  // company's fields live on the form's `newCompany` path, so the single Save
  // creates the company and contact together (one server transaction).
  const [creatingCompany, setCreatingCompany] = useState(false);

  const { form, action, handleSubmitWithAction } = useHookFormAction(
    createContact,
    zodResolver(createContactSchema),
    {
      actionProps: { onSuccess: () => onSaved() },
      formProps: {
        defaultValues: {
          firstName: "",
          lastName: "",
          email: "",
          phone: "",
          companyId: null,
          newCompany: null,
          role: "",
        },
      },
    },
  );

  const {
    register,
    control,
    setValue,
    clearErrors,
    formState: { errors },
  } = form;

  const openCreateCompany = () => {
    setCompanyName(null);
    setValue("companyId", null);
    setValue("newCompany", EMPTY_COMPANY);
    setCreatingCompany(true);
  };

  const cancelCreateCompany = () => {
    setValue("newCompany", null);
    clearErrors("newCompany");
    setCreatingCompany(false);
  };

  return (
    <form onSubmit={handleSubmitWithAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact-first">First name</Label>
          <Input
            id="contact-first"
            aria-invalid={Boolean(errors.firstName)}
            {...register("firstName")}
          />
          {errors.firstName ? (
            <p className="text-sm text-destructive">
              {errors.firstName.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact-last">Last name</Label>
          <Input
            id="contact-last"
            aria-invalid={Boolean(errors.lastName)}
            {...register("lastName")}
          />
          {errors.lastName ? (
            <p className="text-sm text-destructive">
              {errors.lastName.message}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contact-email">Email</Label>
        <Input
          id="contact-email"
          type="email"
          placeholder="person@company.com"
          aria-invalid={Boolean(errors.email)}
          {...register("email")}
        />
        {errors.email ? (
          <p className="text-sm text-destructive">{errors.email.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contact-phone">Phone (optional)</Label>
        <Input
          id="contact-phone"
          type="tel"
          inputMode="tel"
          placeholder="+1 555 123 4567"
          aria-invalid={Boolean(errors.phone)}
          {...register("phone")}
        />
        {errors.phone ? (
          <p className="text-sm text-destructive">{errors.phone.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contact-role">Role</Label>
        <Input
          id="contact-role"
          placeholder="CTO"
          aria-invalid={Boolean(errors.role)}
          {...register("role")}
        />
        {errors.role ? (
          <p className="text-sm text-destructive">{errors.role.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label>Company</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={creatingCompany ? cancelCreateCompany : openCreateCompany}
          >
            {creatingCompany ? "Pick existing" : "New company"}
          </Button>
        </div>

        {creatingCompany ? (
          <div className="flex flex-col gap-4 rounded-md border p-3">
            <Controller
              control={control}
              name="newCompany.isPartner"
              render={({ field }) => (
                <CompanyFields
                  idPrefix="new-company"
                  nameField={register("newCompany.name")}
                  websiteField={register("newCompany.websiteUrl")}
                  isPartner={field.value ?? false}
                  onPartnerChange={field.onChange}
                  errors={{
                    name: errors.newCompany?.name?.message,
                    websiteUrl: errors.newCompany?.websiteUrl?.message,
                  }}
                />
              )}
            />
          </div>
        ) : (
          <Controller
            control={control}
            name="companyId"
            render={({ field }) => (
              <CompanyCombobox
                value={field.value ?? null}
                selectedName={companyName}
                onChange={(next) => {
                  field.onChange(next?.id ?? null);
                  setCompanyName(next?.name ?? null);
                }}
              />
            )}
          />
        )}
      </div>

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
