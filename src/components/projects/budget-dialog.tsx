"use client";

import { IconPencil } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { PlanBudget } from "@/actions/projects/getOpportunityPlan";
import { projectBudgetSchema } from "@/actions/projects/projectBudget.schema";
import { updateProjectBudget } from "@/actions/projects/updateProjectBudget";
import { updateProjectBudgetSchema } from "@/actions/projects/updateProjectBudget.schema";
import { applyServerIssues } from "@/components/form/apply-server-issues";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import {
  BudgetFields,
  type BudgetFormValues,
  budgetDefaultValues,
  budgetIssueFields,
  toBudgetInput,
} from "@/components/projects/budget-fields";
import { Button } from "@/components/ui/button";

/**
 * Re-price a project: set a budget on one that predates budgets, or switch an
 * existing one between billing models.
 *
 * A dialog of its own rather than fields bolted onto the planner's edit-project
 * dialog: that one is about name + delivery managers (and carries a destructive
 * "Remove project" action), and the project detail page has no such dialog at all —
 * it edits fields in place. One shared budget dialog is the only way both surfaces
 * get the identical affordance.
 */
export function ProjectBudgetDialog({
  projectId,
  budget,
  label = "Edit budget",
  onSaved,
}: {
  projectId: string;
  /** The project's current budget — `billingType: null` when it has none yet. */
  budget: PlanBudget;
  /** Trigger copy; the no-budget empty state says "Set budget" instead. */
  label?: string;
  /** Called after a successful save, so a client-loaded plan can re-read. */
  onSaved?: () => void;
}) {
  return (
    <FormDialog
      trigger={
        <Button type="button" variant="outline" size="sm">
          <IconPencil />
          {label}
        </Button>
      }
      // The opportunity's Project-plan tab lives inside a Sheet, so the overlay
      // must stay mounted above it (as the sibling dialogs do).
      forceMountOverlay
      title={label}
      description="How this project bills. Switching billing model replaces the other model's figures."
      contentClassName="max-h-[85vh] overflow-y-auto sm:max-w-lg"
    >
      {({ close }) => (
        <BudgetForm
          projectId={projectId}
          budget={budget}
          onSaved={() => {
            close();
            onSaved?.();
          }}
        />
      )}
    </FormDialog>
  );
}

function BudgetForm({
  projectId,
  budget,
  onSaved,
}: {
  projectId: string;
  budget: PlanBudget;
  onSaved: () => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    setError,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm<BudgetFormValues>({
    defaultValues: budgetDefaultValues(budget),
  });

  const { execute, result, isPending } = useAction(updateProjectBudget, {
    onSuccess: () => {
      toast.success("Budget saved.");
      onSaved();
    },
  });

  const billingType = watch("billingType");

  const onSubmit = (values: BudgetFormValues) => {
    clearErrors();

    // Parsed on its own so issue paths stay leaf-keyed (see `budgetIssueFields`).
    const parsedBudget = projectBudgetSchema.safeParse(toBudgetInput(values));
    if (!parsedBudget.success) {
      applyServerIssues(
        setError,
        parsedBudget.error,
        budgetIssueFields<BudgetFormValues>(),
      );
      return;
    }

    const parsed = updateProjectBudgetSchema.safeParse({
      projectId,
      budget: parsedBudget.data,
    });
    // Only the budget half is user-supplied; a failure here means a malformed id.
    if (!parsed.success) return;

    execute(parsed.data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <BudgetFields
        idPrefix="project-budget"
        control={control}
        register={register}
        errors={errors}
        billingType={billingType}
      />
      <FormDialogFooter
        serverError={result.serverError}
        submitLabel="Save budget"
        loading={isPending}
      />
    </form>
  );
}
