"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { createContact } from "@/actions/crm/createContact";
import { createContactSchema } from "@/actions/crm/createContact.schema";
import type { EntityOption } from "@/components/crm/entity-multi-combobox";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Input } from "@/components/ui/input";

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
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New contact"
      description="Create a contact to add to this opportunity."
      contentClassName="sm:max-w-sm"
      forceMountOverlay
    >
      {({ close }) => (
        <InlineContactForm
          onCreated={(option) => {
            onCreated(option);
            close();
          }}
        />
      )}
    </FormDialog>
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
        e.preventDefault();
        e.stopPropagation();
        handleSubmitWithAction(e);
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="First name"
          htmlFor="inline-contact-first"
          error={errors.firstName?.message}
        >
          <Input
            id="inline-contact-first"
            aria-invalid={Boolean(errors.firstName)}
            {...register("firstName")}
          />
        </FormField>
        <FormField
          label="Last name"
          htmlFor="inline-contact-last"
          error={errors.lastName?.message}
        >
          <Input
            id="inline-contact-last"
            aria-invalid={Boolean(errors.lastName)}
            {...register("lastName")}
          />
        </FormField>
      </div>

      <FormField
        label="Email"
        htmlFor="inline-contact-email"
        error={errors.email?.message}
      >
        <Input
          id="inline-contact-email"
          type="email"
          placeholder="person@company.com"
          aria-invalid={Boolean(errors.email)}
          {...register("email")}
        />
      </FormField>

      <FormDialogFooter
        serverError={action.result.serverError}
        submitLabel="Create contact"
        loading={action.isPending}
      />
    </form>
  );
}
