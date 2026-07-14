"use client";

import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import type { ReactElement } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { createProject } from "@/actions/projects/createProject";
import {
  type CreateProjectInput,
  createProjectSchema,
  type ProjectRoleInput,
} from "@/actions/projects/createProject.schema";
import { searchCompanies } from "@/actions/projects/searchCompanies";
import { searchStaff } from "@/actions/projects/searchStaff";
import { CompanyCombobox } from "@/components/crm/company-combobox";
import {
  applyServerIssues,
  type IssueTarget,
} from "@/components/form/apply-server-issues";
import { EntityCombobox } from "@/components/form/entity-combobox";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "@/components/form/entity-multi-combobox";
import { EnumSelect } from "@/components/form/enum-select";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_LABELS,
  type LineOfBusiness,
} from "@/lib/line-of-business";
import {
  PROJECT_ROLE_TYPE_LABELS,
  PROJECT_ROLE_TYPES,
  type ProjectRoleType,
} from "@/lib/project-role-type";

type RoleFieldValues = {
  staff: EntityOption | null;
  name: string;
  roleType: ProjectRoleType | "";
  startDate: string | null;
  endDate: string | null;
  hoursPerDay: string;
};

type ProjectFormValues = {
  name: string;
  companyId: string;
  companyName: string;
  lineOfBusiness: LineOfBusiness | "";
  deliveryManagers: EntityOption[];
  roles: RoleFieldValues[];
};

const EMPTY_ROLE: RoleFieldValues = {
  staff: null,
  name: "",
  roleType: "",
  startDate: null,
  endDate: null,
  hoursPerDay: "8",
};

// Maps a role sub-field (schema name) to the form field name (per row).
const ROLE_FIELD_FOR_ISSUE: Record<
  keyof ProjectRoleInput,
  keyof RoleFieldValues
> = {
  staffId: "staff",
  name: "name",
  roleType: "roleType",
  startDate: "startDate",
  endDate: "endDate",
  hoursPerDay: "hoursPerDay",
};

// Maps a top-level server-schema issue path to its form field. Typed by
// `keyof CreateProjectInput` so a new schema field can't silently drop its
// errors. `roles` is a field-array: its issues (`roles[i].sub`) route per-row
// through ROLE_FIELD_FOR_ISSUE.
const FIELD_FOR_ISSUE: Record<
  keyof CreateProjectInput,
  IssueTarget<ProjectFormValues>
> = {
  name: "name",
  companyId: "companyId",
  lineOfBusiness: "lineOfBusiness",
  // Prefilled/derived, never surfaced as a form field.
  opportunityId: "companyId",
  deliveryManagerIds: "deliveryManagers",
  roles: { array: "roles", fields: ROLE_FIELD_FOR_ISSUE },
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
 * The create-project dialog. Self-manages its trigger button by default (the
 * projects page); pass `open`/`onOpenChange` to drive it from a parent (the
 * opportunity drawer and the board's delivery-stage prompt), plus the
 * `opportunity`/company props to link and pin it. One component serves all three.
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
          ? "Create the project that delivers this opportunity."
          : "Create a project for a company and staff it with roles."
      }
      contentClassName="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
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
      deliveryManagers: [],
      // Seed one role so the "at least one role" requirement is obvious.
      roles: [EMPTY_ROLE],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "roles" });

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
      deliveryManagerIds: values.deliveryManagers.map((d) => d.id),
      roles: values.roles.map((role) => ({
        staffId: role.staff?.id ?? undefined,
        name: role.name,
        roleType: role.roleType,
        startDate: role.startDate ?? "",
        endDate: role.endDate ?? "",
        hoursPerDay: role.hoursPerDay,
      })),
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

      <FormField label="Delivery managers">
        <Controller
          control={control}
          name="deliveryManagers"
          render={({ field, fieldState }) => (
            <EntityMultiCombobox
              value={field.value}
              onChange={field.onChange}
              searchAction={searchStaff}
              placeholder="Search staff…"
              invalid={Boolean(fieldState.error)}
            />
          )}
        />
      </FormField>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Roles</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append(EMPTY_ROLE)}
          >
            <IconPlus />
            Add role
          </Button>
        </div>

        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            At least one role is required. Add one to staff this project — leave
            the person blank for a placeholder (open) role.
          </p>
        ) : null}

        {errors.roles?.root?.message ? (
          <p className="text-sm text-destructive">
            {errors.roles.root.message}
          </p>
        ) : null}

        {fields.map((rowField, index) => {
          const rowErrors = errors.roles?.[index];
          return (
            <div
              key={rowField.id}
              className="flex flex-col gap-3 rounded border p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Role {index + 1}
                </span>
                <IconButton
                  label={`Remove role ${index + 1}`}
                  size="icon-sm"
                  onClick={() => remove(index)}
                >
                  <IconTrash className="size-4" />
                </IconButton>
              </div>

              <div className="flex gap-3">
                <FormField
                  label="Role type"
                  error={rowErrors?.roleType?.message}
                  className="flex-1"
                >
                  <Controller
                    control={control}
                    name={`roles.${index}.roleType`}
                    render={({ field, fieldState }) => (
                      <EnumSelect
                        options={PROJECT_ROLE_TYPES}
                        labels={PROJECT_ROLE_TYPE_LABELS}
                        placeholder="Select a role type"
                        value={field.value}
                        invalid={Boolean(fieldState.error)}
                        onValueChange={field.onChange}
                      />
                    )}
                  />
                </FormField>

                <FormField
                  label="Name (optional)"
                  htmlFor={`role-name-${index}`}
                  error={rowErrors?.name?.message}
                  className="flex-1"
                >
                  <Input
                    id={`role-name-${index}`}
                    placeholder="Senior Backend Engineer"
                    aria-invalid={Boolean(rowErrors?.name)}
                    {...register(`roles.${index}.name`)}
                  />
                </FormField>
              </div>

              <FormField
                label="Staff (optional)"
                error={rowErrors?.staff?.message}
              >
                <Controller
                  control={control}
                  name={`roles.${index}.staff`}
                  render={({ field, fieldState }) => (
                    <EntityCombobox
                      value={field.value}
                      onChange={field.onChange}
                      searchAction={searchStaff}
                      placeholder="Search staff…"
                      invalid={Boolean(fieldState.error)}
                    />
                  )}
                />
              </FormField>

              <div className="flex gap-3">
                <FormField
                  label="Start date"
                  error={rowErrors?.startDate?.message}
                  className="flex-1"
                >
                  <Controller
                    control={control}
                    name={`roles.${index}.startDate`}
                    render={({ field }) => (
                      <DatePicker
                        value={field.value}
                        onChange={field.onChange}
                        className="w-full"
                      />
                    )}
                  />
                </FormField>

                <FormField
                  label="End date"
                  error={rowErrors?.endDate?.message}
                  className="flex-1"
                >
                  <Controller
                    control={control}
                    name={`roles.${index}.endDate`}
                    render={({ field }) => (
                      <DatePicker
                        value={field.value}
                        onChange={field.onChange}
                        className="w-full"
                      />
                    )}
                  />
                </FormField>

                <FormField
                  label="Hours / day"
                  htmlFor={`role-hours-${index}`}
                  error={rowErrors?.hoursPerDay?.message}
                  className="flex-[2]"
                >
                  <Input
                    id={`role-hours-${index}`}
                    type="number"
                    step="0.5"
                    min="0"
                    max="24"
                    aria-invalid={Boolean(rowErrors?.hoursPerDay)}
                    {...register(`roles.${index}.hoursPerDay`)}
                  />
                </FormField>
              </div>
            </div>
          );
        })}
      </div>

      <FormDialogFooter
        serverError={result.serverError}
        submitLabel="Save"
        loading={isPending}
      />
    </form>
  );
}
