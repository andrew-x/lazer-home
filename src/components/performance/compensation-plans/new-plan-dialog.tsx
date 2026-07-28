"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { IconPlus } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { Controller } from "react-hook-form";
import { createCompensationPlan } from "@/actions/performance/createCompensationPlan";
import { createCompensationPlanSchema } from "@/actions/performance/createCompensationPlan.schema";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { formatIsoDate } from "@/lib/format/format";

/**
 * Create a plan, then navigate into its editor.
 *
 * The staff aren't chosen here: with save-on-edit there is nothing to persist
 * against until the plan row exists, so the plan is created empty and its editor
 * opens the staff picker automatically. That also makes "add staff" one flow
 * rather than two.
 */
export function NewPlanDialog() {
  return (
    <FormDialog
      trigger={
        <Button>
          <IconPlus />
          New plan
        </Button>
      }
      title="New compensation plan"
      description="Name the round and set the date its ratings take effect. You'll pick the staff next."
    >
      {({ close }) => <NewPlanForm onCreated={close} />}
    </FormDialog>
  );
}

function NewPlanForm({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();

  const { form, action, handleSubmitWithAction } = useHookFormAction(
    createCompensationPlan,
    zodResolver(createCompensationPlanSchema),
    {
      actionProps: {
        onSuccess: ({ data }) => {
          onCreated();
          if (data)
            router.push(`/performance/compensation-plans/${data.planId}`);
        },
      },
      formProps: {
        defaultValues: {
          name: "",
          effectiveDate: formatIsoDate(new Date()),
          staffIds: [],
        },
      },
    },
  );

  const {
    control,
    register,
    formState: { errors },
  } = form;

  return (
    <form onSubmit={handleSubmitWithAction} className="flex flex-col gap-4">
      <FormField label="Name" htmlFor="plan-name" error={errors.name?.message}>
        <Input
          id="plan-name"
          placeholder="H2 2026 review"
          aria-invalid={Boolean(errors.name)}
          {...register("name")}
        />
      </FormField>

      <FormField
        label="Effective date"
        htmlFor="plan-effective-date"
        error={errors.effectiveDate?.message}
      >
        <Controller
          control={control}
          name="effectiveDate"
          render={({ field }) => (
            <DatePicker
              id="plan-effective-date"
              className="w-full"
              value={field.value ?? null}
              onChange={(next) => field.onChange(next ?? "")}
            />
          )}
        />
      </FormField>

      <FormDialogFooter
        serverError={action.result.serverError}
        submitLabel="Create plan"
        loading={action.isPending}
      />
    </form>
  );
}
