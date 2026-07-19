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
import { EnumSelect } from "@/components/form/enum-select";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_LABELS,
  type LineOfBusiness,
} from "@/lib/line-of-business";

type ProjectFormValues = {
  name: string;
  companyId: string;
  companyName: string;
  lineOfBusiness: LineOfBusiness | "";
};

// Maps a top-level server-schema issue path to its form field. Typed by
// `keyof CreateProjectInput` so a new schema field can't silently drop its
// errors. Fields the simplified form no longer collects (status, delivery
// managers, roles — all defaulted server-side) route to `name` as a harmless
// fallback; they can't produce validation issues from this form.
const FIELD_FOR_ISSUE: Record<
  keyof CreateProjectInput,
  IssueTarget<ProjectFormValues>
> = {
  name: "name",
  companyId: "companyId",
  lineOfBusiness: "lineOfBusiness",
  status: "name",
  opportunityId: "companyId",
  deliveryManagerIds: "name",
  roles: "name",
};

type ProjectDialogProps = {
  /** Link the created project to this CRM opportunity. */
  opportunityId?: string;
  /** Prefill (and, with `lockCompany`, pin) the company. */
  defaultCompanyId?: string;
  defaultCompanyName?: string;
  /**
   * Prefill the line of business — used when creating from an opportunity, so
   * the project defaults to the opportunity's line of business (still editable).
   */
  defaultLineOfBusiness?: LineOfBusiness;
  /** Render the company read-only — used when creating from an opportunity. */
  lockCompany?: boolean;
  /** Called with the new project's id after a successful create. */
  onCreated?: (projectId: string) => void;
};

/**
 * The create-project dialog. Deliberately minimal — it collects only name,
 * company, and line of business; roles and delivery managers are added
 * afterward in the project planner (the opportunity drawer's "Project plan"
 * tab). Self-manages its trigger button by default (the projects page); pass
 * `open`/`onOpenChange` to drive it from a parent (the opportunity drawer and
 * the board's delivery-stage prompt), plus the `opportunity`/company props to
 * link and pin it. One component serves all three.
 */
export function AddProjectDialog({
  trigger,
  open,
  onOpenChange,
  forceMountOverlay,
  opportunityId,
  defaultCompanyId,
  defaultCompanyName,
  defaultLineOfBusiness,
  lockCompany,
  onCreated,
}: ProjectDialogProps & {
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Render this dialog's own backdrop even when nested inside another open
   * dialog (e.g. the opportunity drawer) — otherwise Base UI suppresses it and
   * the parent surface stays unblurred behind this dialog.
   */
  forceMountOverlay?: boolean;
}) {
  const controlled = open !== undefined && onOpenChange !== undefined;
  const resolvedTrigger = controlled
    ? undefined
    : (trigger ?? (
        <Button size="sm">
          <IconPlus />
          Add project
        </Button>
      ));

  return (
    <FormDialog
      trigger={resolvedTrigger}
      open={open}
      onOpenChange={onOpenChange}
      forceMountOverlay={forceMountOverlay}
      title="Add project"
      description={
        opportunityId
          ? "Create the project that delivers this opportunity. Add roles and delivery managers afterward in its planner."
          : "Create a project for a company. Add roles and delivery managers afterward in its planner."
      }
      contentClassName="max-h-[85vh] overflow-y-auto sm:max-w-lg"
    >
      {({ close }) => (
        <ProjectForm
          onSaved={close}
          opportunityId={opportunityId}
          defaultCompanyId={defaultCompanyId}
          defaultCompanyName={defaultCompanyName}
          defaultLineOfBusiness={defaultLineOfBusiness}
          lockCompany={lockCompany}
          onCreated={onCreated}
        />
      )}
    </FormDialog>
  );
}

function ProjectForm({
  onSaved,
  opportunityId,
  defaultCompanyId,
  defaultCompanyName,
  defaultLineOfBusiness,
  lockCompany,
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
      companyId: defaultCompanyId ?? "",
      companyName: defaultCompanyName ?? "",
      lineOfBusiness: defaultLineOfBusiness ?? "",
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
    const payload = {
      name: values.name,
      companyId: values.companyId,
      lineOfBusiness: values.lineOfBusiness,
      opportunityId,
    };

    const parsed = createProjectSchema.safeParse(payload);
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

      {lockCompany ? (
        <FormField label="Company">
          <p className="text-sm text-muted-foreground">
            {defaultCompanyName ?? "—"}
          </p>
        </FormField>
      ) : (
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
      )}

      <FormField
        label="Line of business"
        error={errors.lineOfBusiness?.message}
      >
        <Controller
          control={control}
          name="lineOfBusiness"
          render={({ field, fieldState }) => (
            <EnumSelect
              options={LINE_OF_BUSINESS}
              labels={LINE_OF_BUSINESS_LABELS}
              placeholder="Select a line of business"
              value={field.value}
              invalid={Boolean(fieldState.error)}
              onValueChange={field.onChange}
            />
          )}
        />
      </FormField>

      <FormDialogFooter
        serverError={result.serverError}
        submitLabel="Save"
        loading={isPending}
      />
    </form>
  );
}
