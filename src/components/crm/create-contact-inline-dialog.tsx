"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { createContact } from "@/actions/crm/createContact";
import { createContactSchema } from "@/actions/crm/createContact.schema";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { stopBubblingSubmit } from "@/components/form/stop-bubbling-submit";
import { contactName } from "@/lib/crm/contact-name";
import { ContactFields } from "./contact-fields";

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
          onCreated({ id: data.id, name: contactName(form.getValues()) });
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
      onSubmit={stopBubblingSubmit(handleSubmitWithAction)}
      className="flex flex-col gap-4"
    >
      <ContactFields
        idPrefix="inline-contact"
        firstNameField={register("firstName")}
        lastNameField={register("lastName")}
        emailField={register("email")}
        errors={{
          firstName: errors.firstName?.message,
          lastName: errors.lastName?.message,
          email: errors.email?.message,
        }}
      />

      <FormDialogFooter
        serverError={action.result.serverError}
        submitLabel="Create contact"
        loading={action.isPending}
      />
    </form>
  );
}
