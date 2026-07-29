"use client";

import { useAction } from "next-safe-action/hooks";
import { type ReactElement, useEffect } from "react";
import { useForm } from "react-hook-form";
import { createProjectFromOpportunity } from "@/actions/projects/createProjectFromOpportunity";
import { createProjectFromOpportunitySchema } from "@/actions/projects/createProjectFromOpportunity.schema";
import { projectBudgetSchema } from "@/actions/projects/projectBudget.schema";
import { applyServerIssues } from "@/components/form/apply-server-issues";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import {
  BudgetFields,
  type BudgetFormValues,
  budgetDefaultValues,
  budgetIssueFields,
  toBudgetInput,
} from "@/components/projects/budget-fields";

/**
 * Create a project straight from an opportunity. The project inherits the deal's
 * name and company server-side, so the only thing to fill in is how the work bills
 * — the same `BudgetFields` the standalone create dialog uses.
 *
 * Used from two places: the Project-plan tab's empty state, and the board's prompt
 * when a deal is dragged into a delivery stage. Both need `onCreated` to run their
 * own follow-up (reload the plan / complete the pending stage move), so this owns no
 * navigation of its own.
 */
export function CreateProjectFromOpportunityDialog({
  opportunityId,
  companyName,
  trigger,
  open,
  onOpenChange,
  description,
  onPendingChange,
  onCreated,
}: {
  opportunityId: string;
  /** Named in the description so it's clear whose project this becomes. */
  companyName: string;
  /** Omit together with `open`/`onOpenChange` when the parent drives the dialog. */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Overrides the default copy — the board's prompt explains the stage move. */
  description?: string;
  /**
   * Reports in-flight state to a controlling parent, so it can refuse to close the
   * dialog mid-submit. The board needs this: dismissing while the create is in
   * flight would drop its pending stage move while the project still gets created.
   */
  onPendingChange?: (pending: boolean) => void;
  onCreated: () => void;
}) {
  return (
    <FormDialog
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      // The Project-plan tab lives inside a Sheet; without this the dialog's
      // overlay unmounts under it (the same reason the sibling dialogs pass it).
      forceMountOverlay
      title="Create project"
      description={
        description ??
        `A new project for ${companyName}, inheriting this opportunity's name. Set how it bills — you can change this later.`
      }
      contentClassName="max-h-[85vh] overflow-y-auto sm:max-w-lg"
    >
      {({ close }) => (
        <BudgetOnlyForm
          opportunityId={opportunityId}
          onPendingChange={onPendingChange}
          onSaved={() => {
            close();
            onCreated();
          }}
        />
      )}
    </FormDialog>
  );
}

function BudgetOnlyForm({
  opportunityId,
  onPendingChange,
  onSaved,
}: {
  opportunityId: string;
  onPendingChange?: (pending: boolean) => void;
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
  } = useForm<BudgetFormValues>({ defaultValues: budgetDefaultValues() });

  const { execute, result, isPending } = useAction(
    createProjectFromOpportunity,
    { onSuccess: onSaved },
  );

  const billingType = watch("billingType");

  useEffect(() => {
    onPendingChange?.(isPending);
  }, [isPending, onPendingChange]);

  const onSubmit = (values: BudgetFormValues) => {
    clearErrors();

    // Parse the budget slice first so its issues stay leaf-keyed for
    // `applyServerIssues` (see `budgetIssueFields`).
    const budget = projectBudgetSchema.safeParse(toBudgetInput(values));
    if (!budget.success) {
      applyServerIssues(
        setError,
        budget.error,
        budgetIssueFields<BudgetFormValues>(),
      );
      return;
    }

    const parsed = createProjectFromOpportunitySchema.safeParse({
      opportunityId,
      budget: budget.data,
    });
    // Only the budget half is user-supplied here, so a failure means the id is
    // malformed — nothing a field message could help with.
    if (!parsed.success) return;

    execute(parsed.data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <BudgetFields
        idPrefix="opportunity-project"
        control={control}
        register={register}
        errors={errors}
        billingType={billingType}
      />
      <FormDialogFooter
        serverError={result.serverError}
        submitLabel="Create project"
        loading={isPending}
      />
    </form>
  );
}
