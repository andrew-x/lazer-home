"use client";

import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import {
  Controller,
  type FieldPath,
  useFieldArray,
  useForm,
} from "react-hook-form";
import { createProject } from "@/actions/projects/createProject";
import {
  type CreateProjectInput,
  createProjectSchema,
  type ProjectRoleInput,
} from "@/actions/projects/createProject.schema";
import { searchCompanies } from "@/actions/projects/searchCompanies";
import { searchStaff } from "@/actions/projects/searchStaff";
import { CompanyCombobox } from "@/components/crm/company-combobox";
import { EntityCombobox } from "@/components/crm/entity-combobox";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "@/components/crm/entity-multi-combobox";
import { EnumSelect } from "@/components/form/enum-select";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_LABELS,
  type LineOfBusiness,
} from "@/lib/line-of-business";

type RoleFieldValues = {
  staff: EntityOption | null;
  lineOfBusiness: LineOfBusiness | "";
  startDate: string | null;
  endDate: string | null;
  hoursPerDay: string;
};

type ProjectFormValues = {
  name: string;
  companyId: string;
  companyName: string;
  deliveryManagers: EntityOption[];
  roles: RoleFieldValues[];
};

const EMPTY_ROLE: RoleFieldValues = {
  staff: null,
  lineOfBusiness: "",
  startDate: null,
  endDate: null,
  hoursPerDay: "8",
};

const DEFAULT_VALUES: ProjectFormValues = {
  name: "",
  companyId: "",
  companyName: "",
  deliveryManagers: [],
  roles: [],
};

// Maps a top-level server-schema issue path to its form field. Typed by
// `keyof CreateProjectInput` so a new schema field can't silently drop its errors.
const FIELD_FOR_ISSUE: Record<
  keyof CreateProjectInput,
  FieldPath<ProjectFormValues>
> = {
  name: "name",
  companyId: "companyId",
  deliveryManagerIds: "deliveryManagers",
  roles: "roles",
};

// Maps a role sub-field (schema name) to the form field name (per row).
const ROLE_FIELD_FOR_ISSUE: Record<
  keyof ProjectRoleInput,
  keyof RoleFieldValues
> = {
  staffId: "staff",
  lineOfBusiness: "lineOfBusiness",
  startDate: "startDate",
  endDate: "endDate",
  hoursPerDay: "hoursPerDay",
};

export function AddProjectDialog() {
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <IconPlus />
          Add project
        </Button>
      }
      title="Add project"
      description="Create a project for a company and staff it with roles."
      contentClassName="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
    >
      {({ close }) => <ProjectForm onSaved={close} />}
    </FormDialog>
  );
}

function ProjectForm({ onSaved }: { onSaved: () => void }) {
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm<ProjectFormValues>({ defaultValues: DEFAULT_VALUES });

  const { fields, append, remove } = useFieldArray({ control, name: "roles" });

  const { execute, result, isPending } = useAction(createProject, {
    onSuccess: () => onSaved(),
  });

  const companyName = watch("companyName");

  const onSubmit = (values: ProjectFormValues) => {
    clearErrors();
    const payload = {
      name: values.name,
      companyId: values.companyId,
      deliveryManagerIds: values.deliveryManagers.map((d) => d.id),
      roles: values.roles.map((role) => ({
        staffId: role.staff?.id ?? "",
        lineOfBusiness: role.lineOfBusiness,
        startDate: role.startDate ?? "",
        endDate: role.endDate ?? "",
        hoursPerDay: role.hoursPerDay,
      })),
    };

    const parsed = createProjectSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const [head, index, sub] = issue.path;
        if (
          head === "roles" &&
          typeof index === "number" &&
          typeof sub === "string"
        ) {
          const field = ROLE_FIELD_FOR_ISSUE[sub as keyof ProjectRoleInput];
          if (field) {
            setError(
              `roles.${index}.${field}` as FieldPath<ProjectFormValues>,
              {
                message: issue.message,
              },
            );
          }
          continue;
        }
        if (typeof head === "string" && head in FIELD_FOR_ISSUE) {
          setError(FIELD_FOR_ISSUE[head as keyof CreateProjectInput], {
            message: issue.message,
          });
        }
      }
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
            No roles yet. Add one to staff this project.
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove role ${index + 1}`}
                  onClick={() => remove(index)}
                >
                  <IconTrash className="size-4" />
                </Button>
              </div>

              <div className="flex gap-3">
                <FormField
                  label="Staff"
                  error={rowErrors?.staff?.message}
                  className="flex-1"
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

                <FormField
                  label="Line of business"
                  error={rowErrors?.lineOfBusiness?.message}
                  className="flex-1"
                >
                  <Controller
                    control={control}
                    name={`roles.${index}.lineOfBusiness`}
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
              </div>

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
