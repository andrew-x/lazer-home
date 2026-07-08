"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil } from "@tabler/icons-react";
import { updateStaffClientIntro } from "@/actions/staff/updateStaffClientIntro";
import { updateStaffClientIntroSchema } from "@/actions/staff/updateStaffClientIntro.schema";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function EditClientIntroDialog({
  staffId,
  clientIntro,
}: {
  staffId: string;
  clientIntro: string | null;
}) {
  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="sm">
          <IconPencil />
          Edit
        </Button>
      }
      title="Edit client intro"
      description="How this person is introduced to clients. Leave blank to clear it."
    >
      {({ close }) => (
        <ClientIntroForm
          staffId={staffId}
          clientIntro={clientIntro}
          onSaved={close}
        />
      )}
    </FormDialog>
  );
}

function ClientIntroForm({
  staffId,
  clientIntro,
  onSaved,
}: {
  staffId: string;
  clientIntro: string | null;
  onSaved: () => void;
}) {
  const { form, action, handleSubmitWithAction } = useHookFormAction(
    updateStaffClientIntro,
    zodResolver(updateStaffClientIntroSchema),
    {
      actionProps: { onSuccess: () => onSaved() },
      formProps: { defaultValues: { staffId, clientIntro: clientIntro ?? "" } },
    },
  );

  const {
    register,
    formState: { errors },
  } = form;

  return (
    <form onSubmit={handleSubmitWithAction} className="flex flex-col gap-4">
      <input type="hidden" {...register("staffId")} />
      <FormField
        label="Client intro"
        htmlFor="clientIntro"
        error={errors.clientIntro?.message}
      >
        <Textarea
          id="clientIntro"
          rows={12}
          className="min-h-64"
          placeholder="A few paragraphs introducing this person to clients — background, focus areas, and what they bring to an engagement…"
          aria-invalid={Boolean(errors.clientIntro)}
          {...register("clientIntro")}
        />
      </FormField>

      <FormDialogFooter
        serverError={action.result.serverError}
        submitLabel="Save"
        loading={action.isPending}
      />
    </form>
  );
}
