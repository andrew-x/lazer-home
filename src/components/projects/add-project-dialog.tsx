"use client";

import { IconPlus } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import type { ReactElement } from "react";
import { Controller, useForm } from "react-hook-form";
import { createProject } from "@/actions/projects/createProject";
import {
  type CreateProjectInput,
  createProjectSchema,
} from "@/actions/projects/createProject.schema";
import { projectBudgetSchema } from "@/actions/projects/projectBudget.schema";
import { searchCompanies } from "@/actions/projects/searchCompanies";
import { CompanyCombobox } from "@/components/crm/company-combobox";
import {
  applyServerIssues,
  type IssueTarget,
} from "@/components/form/apply-server-issues";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import {
  BudgetFields,
  type BudgetFormValues,
  budgetDefaultValues,
  budgetIssueFields,
  toBudgetInput,
} from "@/components/projects/budget-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ProjectFormValues = BudgetFormValues & {
  name: string;
  companyId: string;
  companyName: string;
};

// Maps a top-level server-schema issue path to its form field. Typed by
// `keyof CreateProjectInput` so a new schema field can't silently drop its
// errors. Fields the standalone form no longer collects (roles — added later in
// the planner; opportunityId — not used standalone) route to `name` as a harmless
// fallback; they can't produce validation issues here.
// `budget` likewise: the budget slice is parsed separately (see `onSubmit`), so
// its issues arrive already keyed by leaf field via `budgetIssueFields`.
const FIELD_FOR_ISSUE: Record<
  keyof CreateProjectInput,
  IssueTarget<ProjectFormValues>
> = {
  name: "name",
  companyId: "companyId",
  opportunityId: "companyId",
  roles: "name",
  budget: "billingType",
};

type ProjectDialogProps = {
  /** Called with the new project's id after a successful create. */
  onCreated?: (projectId: string) => void;
};

/**
 * The standalone create-project dialog (the projects page). Collects name, company
 * and how the work bills; a project's status, lines of business and delivery
 * managers are all derived from its roles, which are added afterward in the planner.
 * Projects created from an opportunity go through
 * `CreateProjectFromOpportunityDialog` instead, which inherits name + company from
 * the deal and asks for the same budget.
 */
export function AddProjectDialog({
  trigger,
  onCreated,
}: ProjectDialogProps & {
  trigger?: ReactElement;
}) {
  return (
    <FormDialog
      trigger={
        trigger ?? (
          <Button size="sm">
            <IconPlus />
            Add project
          </Button>
        )
      }
      title="Add project"
      description="Create a project for a company and set how it bills. Add roles — including a delivery role — afterward in its planner."
      contentClassName="max-h-[85vh] overflow-y-auto sm:max-w-lg"
    >
      {({ close }) => <ProjectForm onSaved={close} onCreated={onCreated} />}
    </FormDialog>
  );
}

function ProjectForm({
  onSaved,
  onCreated,
}: ProjectDialogProps & { onSaved: () => void }) {
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm<ProjectFormValues>({
    defaultValues: {
      name: "",
      companyId: "",
      companyName: "",
      ...budgetDefaultValues(),
    },
  });

  const { execute, result, isPending } = useAction(createProject, {
    onSuccess: ({ data }) => {
      if (data?.id) onCreated?.(data.id);
      onSaved();
    },
  });

  const companyName = watch("companyName");
  const billingType = watch("billingType");

  const onSubmit = (values: ProjectFormValues) => {
    clearErrors();

    // The budget slice is validated on its own so its issue paths stay leaf-keyed
    // (`budgetAmount`, not `budget.budgetAmount`) — `applyServerIssues` routes on
    // `path[0]`. See `budgetIssueFields`.
    const budget = projectBudgetSchema.safeParse(toBudgetInput(values));
    if (!budget.success) {
      applyServerIssues(
        setError,
        budget.error,
        budgetIssueFields<ProjectFormValues>(),
      );
      return;
    }

    const parsed = createProjectSchema.safeParse({
      name: values.name,
      companyId: values.companyId,
      budget: budget.data,
    });
    if (!parsed.success) {
      applyServerIssues(setError, parsed.error, FIELD_FOR_ISSUE);
      return;
    }

    execute(parsed.data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <FormField
        label="Name"
        htmlFor="project-name"
        error={errors.name?.message}
      >
        <Input
          id="project-name"
          placeholder="Acme platform build"
          aria-invalid={Boolean(errors.name)}
          {...register("name")}
        />
      </FormField>

      <Controller
        control={control}
        name="companyId"
        render={({ field }) => (
          <FormField label="Company" error={errors.companyId?.message}>
            <CompanyCombobox
              value={field.value || null}
              selectedName={companyName || null}
              searchAction={searchCompanies}
              onChange={(next) => {
                field.onChange(next?.id ?? "");
                setValue("companyName", next?.name ?? "");
                if (next) clearErrors("companyId");
              }}
            />
          </FormField>
        )}
      />

      <BudgetFields
        idPrefix="project"
        control={control}
        register={register}
        errors={errors}
        billingType={billingType}
      />

      <FormDialogFooter
        serverError={result.serverError}
        submitLabel="Save"
        loading={isPending}
      />
    </form>
  );
}
