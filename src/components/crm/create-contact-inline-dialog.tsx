"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { createContact } from "@/actions/crm/createContact";
import { createContactSchema } from "@/actions/crm/createContact.schema";
import type { EntityOption } from "@/components/crm/entity-multi-combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A minimal create-contact dialog for inline use inside the opportunity form.
 * Persists the contact via `createContact` (an independent CRM write) and hands
 * the new `{ id, name }` back so the caller can add it to a selection.
 */
export function CreateContactInlineDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (option: EntityOption) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" forceMountOverlay>
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
          <DialogDescription>
            Create a contact to add to this opportunity.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <InlineContactForm
            onCreated={(option) => {
              onCreated(option);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function InlineContactForm({
  onCreated,
}: {
  onCreated: (option: EntityOption) => void;
}) {
  const { form, action, handleSubmitWithAction } = useHookFormAction(
    createContact,
    zodResolver(createContactSchema),
    {
      actionProps: {
        onSuccess: ({ data }) => {
          if (!data?.id) return;
          const { firstName, lastName } = form.getValues();
          onCreated({ id: data.id, name: `${firstName} ${lastName}` });
        },
      },
      formProps: {
        defaultValues: {
          firstName: "",
          lastName: "",
          email: "",
          phone: "",
          companyId: null,
          role: "",
        },
      },
    },
  );

  const {
    register,
    formState: { errors },
  } = form;

  return (
    <form
      // This form is portaled but remains a React descendant of the form that
      // opened it, so its submit would bubble and validate the parent form.
      // Stop it at the boundary.
      onSubmit={(e) => {
        e.stopPropagation();
        handleSubmitWithAction(e);
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inline-contact-first">First name</Label>
          <Input
            id="inline-contact-first"
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
          <Label htmlFor="inline-contact-last">Last name</Label>
          <Input
            id="inline-contact-last"
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
        <Label htmlFor="inline-contact-email">Email</Label>
        <Input
          id="inline-contact-email"
          type="email"
          placeholder="person@company.com"
          aria-invalid={Boolean(errors.email)}
          {...register("email")}
        />
        {errors.email ? (
          <p className="text-sm text-destructive">{errors.email.message}</p>
        ) : null}
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
          Create contact
        </Button>
      </DialogFooter>
    </form>
  );
}
