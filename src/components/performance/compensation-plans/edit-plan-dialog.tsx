"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPencil } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { Controller } from "react-hook-form";
import { updateCompensationPlan } from "@/actions/performance/updateCompensationPlan";
import { updateCompensationPlanSchema } from "@/actions/performance/updateCompensationPlan.schema";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";

/**
 * Rename a draft plan or move its effective date.
 *
 * The date being editable is load-bearing, not a convenience: commit refuses a
 * plan dated before any member's most recent rating and tells the user to move
 * the date forward, which is only actionable if there is somewhere to move it.
 */
export function EditPlanDialog({
  planId,
  name,
  effectiveDate,
}: {
  planId: string;
  name: string;
  effectiveDate: string;
}) {
  return (
    <FormDialog
      trigger={
        <Button variant="outline">
          <IconPencil />
          Edit plan
        </Button>
      }
      title="Edit plan"
      description="Rename the round or move the date its ratings take effect."
    >
      {({ close }) => (
        <EditPlanForm
          planId={planId}
          name={name}
          effectiveDate={effectiveDate}
          onSaved={close}
        />
      )}
    </FormDialog>
  );
}

function EditPlanForm({
  planId,
  name,
  effectiveDate,
  onSaved,
}: {
  planId: string;
  name: string;
  effectiveDate: string;
  onSaved: () => void;
}) {
  const router = useRouter();

  const { form, action, handleSubmitWithAction } = useHookFormAction(
    updateCompensationPlan,
    zodResolver(updateCompensationPlanSchema),
    {
      actionProps: {
        onSuccess: () => {
          onSaved();
          router.refresh();
        },
      },
      formProps: { defaultValues: { planId, name, effectiveDate } },
    },
  );

  const {
    control,
    register,
    formState: { errors },
  } = form;

  return (
    <form onSubmit={handleSubmitWithAction} className="flex flex-col gap-4">
      <input type="hidden" {...register("planId")} />

      <FormField
        label="Name"
        htmlFor="edit-plan-name"
        error={errors.name?.message}
      >
        <Input
          id="edit-plan-name"
          aria-invalid={Boolean(errors.name)}
          {...register("name")}
        />
      </FormField>

      <FormField
        label="Effective date"
        htmlFor="edit-plan-effective-date"
        error={errors.effectiveDate?.message}
      >
        <Controller
          control={control}
          name="effectiveDate"
          render={({ field }) => (
            <DatePicker
              id="edit-plan-effective-date"
              className="w-full"
              value={field.value ?? null}
              onChange={(next) => field.onChange(next ?? "")}
            />
          )}
        />
      </FormField>

      <FormDialogFooter
        serverError={action.result.serverError}
        submitLabel="Save changes"
        loading={action.isPending}
      />
    </form>
  );
}
