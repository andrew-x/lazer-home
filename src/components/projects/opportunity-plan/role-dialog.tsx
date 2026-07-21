"use client";

import { useAction } from "next-safe-action/hooks";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { createProjectRole } from "@/actions/projects/createProjectRole";
import { createProjectRoleSchema } from "@/actions/projects/createProjectRole.schema";
import { deleteProjectRole } from "@/actions/projects/deleteProjectRole";
import type { PlanRole } from "@/actions/projects/getOpportunityPlan";
import { searchStaff } from "@/actions/projects/searchStaff";
import { updateProjectRole } from "@/actions/projects/updateProjectRole";
import { updateProjectRoleSchema } from "@/actions/projects/updateProjectRole.schema";
import {
  applyServerIssues,
  type IssueTarget,
} from "@/components/form/apply-server-issues";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
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
import {
  PROJECT_ROLE_TYPE_LABELS,
  PROJECT_ROLE_TYPES,
  type ProjectRoleType,
} from "@/lib/project-role-type";

type RoleFormValues = {
  staff: EntityOption | null;
  lineOfBusiness: LineOfBusiness | "";
  description: string;
  roleType: ProjectRoleType | "";
  startDate: string | null;
  endDate: string | null;
  hoursPerDay: string;
};

// Maps each role schema field to its form field (note `staffId` → `staff`); the
// server-controlled `id`/`opportunityId` never surface as form errors.
const ROLE_ISSUE_FIELDS: Record<string, IssueTarget<RoleFormValues>> = {
  staffId: "staff",
  lineOfBusiness: "lineOfBusiness",
  description: "description",
  roleType: "roleType",
  startDate: "startDate",
  endDate: "endDate",
  hoursPerDay: "hoursPerDay",
};

export function RoleDialog({
  opportunityId,
  defaultLineOfBusiness,
  existing,
  onClose,
  onSaved,
}: {
  opportunityId: string;
  /** Default line of business for a new role — the opportunity's own. */
  defaultLineOfBusiness: LineOfBusiness;
  existing: PlanRole | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = existing !== null;
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RoleFormValues>({
    defaultValues: {
      staff:
        existing?.staffId && existing.staffName
          ? { id: existing.staffId, name: existing.staffName }
          : null,
      lineOfBusiness: existing?.lineOfBusiness ?? defaultLineOfBusiness,
      description: existing?.description ?? "",
      roleType: existing?.roleType ?? "",
      startDate: existing?.startDate ?? null,
      endDate: existing?.endDate ?? null,
      hoursPerDay: existing ? String(existing.hoursPerDay) : "8",
    },
  });

  const create = useAction(createProjectRole, {
    onSuccess: onSaved,
  });
  const update = useAction(updateProjectRole, {
    onSuccess: onSaved,
  });
  const remove = useAction(deleteProjectRole, {
    onSuccess: onSaved,
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't remove the role."),
  });

  const pending = create.isPending || update.isPending || remove.isPending;
  const serverError =
    create.result.serverError ??
    update.result.serverError ??
    remove.result.serverError;

  const onSubmit = (values: RoleFormValues) => {
    const shared = {
      staffId: values.staff?.id ?? undefined,
      lineOfBusiness: values.lineOfBusiness,
      description: values.description,
      roleType: values.roleType,
      startDate: values.startDate ?? "",
      endDate: values.endDate ?? "",
      hoursPerDay: values.hoursPerDay,
    };

    if (isEdit && existing) {
      const parsed = updateProjectRoleSchema.safeParse({
        id: existing.id,
        opportunityId,
        ...shared,
      });
      if (!parsed.success) {
        applyServerIssues(setError, parsed.error, ROLE_ISSUE_FIELDS);
        return;
      }
      update.execute(parsed.data);
    } else {
      const parsed = createProjectRoleSchema.safeParse({
        opportunityId,
        ...shared,
      });
      if (!parsed.success) {
        applyServerIssues(setError, parsed.error, ROLE_ISSUE_FIELDS);
        return;
      }
      create.execute(parsed.data);
    }
  };

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      forceMountOverlay
      title={isEdit ? "Edit role" : "Add role"}
      description={
        isEdit
          ? "Adjust this tentative role for the opportunity."
          : "Add a tentative role to this opportunity's project. Leave the person blank for an open position."
      }
      contentClassName="max-h-[85vh] overflow-y-auto sm:max-w-lg"
    >
      {() => (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <FormField
              label="Line of business"
              error={errors.lineOfBusiness?.message}
              className="flex-1 min-w-0"
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
            <FormField
              label="Role type"
              error={errors.roleType?.message}
              className="flex-1 min-w-0"
            >
              <Controller
                control={control}
                name="roleType"
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
          </div>

          <FormField
            label="Description (optional)"
            htmlFor="role-description"
            error={errors.description?.message}
          >
            <Input
              id="role-description"
              placeholder="Senior Backend Engineer"
              aria-invalid={Boolean(errors.description)}
              {...register("description")}
            />
          </FormField>

          <FormField label="Staff (optional)" error={errors.staff?.message}>
            <Controller
              control={control}
              name="staff"
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
              error={errors.startDate?.message}
              className="flex-1 min-w-0"
            >
              <Controller
                control={control}
                name="startDate"
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
              error={errors.endDate?.message}
              className="flex-1 min-w-0"
            >
              <Controller
                control={control}
                name="endDate"
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
              htmlFor="role-hours"
              error={errors.hoursPerDay?.message}
              className="flex-1 min-w-0"
            >
              <Input
                id="role-hours"
                type="number"
                step="0.5"
                min="0"
                max="24"
                aria-invalid={Boolean(errors.hoursPerDay)}
                {...register("hoursPerDay")}
              />
            </FormField>
          </div>

          <div className="flex items-center justify-between gap-3">
            {isEdit ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={pending}
                onClick={() =>
                  existing && remove.execute({ id: existing.id, opportunityId })
                }
              >
                Remove
              </Button>
            ) : (
              <span />
            )}
            <FormDialogFooter
              serverError={serverError}
              submitLabel={isEdit ? "Save" : "Add role"}
              loading={pending}
            />
          </div>
        </form>
      )}
    </FormDialog>
  );
}
