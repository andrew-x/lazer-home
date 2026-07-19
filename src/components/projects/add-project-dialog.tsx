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
import { searchCompanies } from "@/actions/projects/searchCompanies";
import { CompanyCombobox } from "@/components/crm/company-combobox";
import {
  applyServerIssues,
  type IssueTarget,
} from "@/components/form/apply-server-issues";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ProjectFormValues = {
  name: string;
  companyId: string;
  companyName: string;
};

// Maps a top-level server-schema issue path to its form field. Typed by
// `keyof CreateProjectInput` so a new schema field can't silently drop its
// errors. Fields the standalone form no longer collects (delivery managers,
// roles — added later in the planner; opportunityId — not used standalone) route
// to `name` as a harmless fallback; they can't produce validation issues here.
const FIELD_FOR_ISSUE: Record<
  keyof CreateProjectInput,
  IssueTarget<ProjectFormValues>
> = {
  name: "name",
  companyId: "companyId",
  opportunityId: "companyId",
  deliveryManagerIds: "name",
  roles: "name",
};

type ProjectDialogProps = {
  /** Called with the new project's id after a successful create. */
  onCreated?: (projectId: string) => void;
};

/**
 * The standalone create-project dialog (the projects page). Deliberately
 * minimal — it collects only name and company; a project's status and lines of
 * business are derived from its roles, which (with delivery managers) are added
 * afterward in the planner. Projects created from an opportunity skip this dialog
 * entirely (one-click `createProjectFromOpportunity`, inheriting name + company).
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
      description="Create a project for a company. Add roles and delivery managers afterward in its planner."
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
    },
  });

  const { execute, result, isPending } = useAction(createProject, {
    onSuccess: ({ data }) => {
      if (data?.id) onCreated?.(data.id);
      onSaved();
    },
  });

  const companyName = watch("companyName");

  const onSubmit = (values: ProjectFormValues) => {
    clearErrors();
    const parsed = createProjectSchema.safeParse({
      name: values.name,
      companyId: values.companyId,
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

      <FormDialogFooter
        serverError={result.serverError}
        submitLabel="Save"
        loading={isPending}
      />
    </form>
  );
}
