"use client";

import { useAction } from "next-safe-action/hooks";
import { Controller, useForm } from "react-hook-form";
import { allocateStaffToRole } from "@/actions/allocations/allocateStaffToRole";
import { allocateStaffToRoleSchema } from "@/actions/allocations/allocateStaffToRole.schema";
import type { ProjectAllocationRoleRow } from "@/actions/allocations/getProjectAllocationsGrid";
import { searchStaff } from "@/actions/projects/searchStaff";
import {
  applyServerIssues,
  type IssueTarget,
} from "@/components/form/apply-server-issues";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { PROJECT_ROLE_TYPE_LABELS } from "@/lib/projects/project-role-type";

type StaffRoleFormValues = {
  staff: EntityOption | null;
  startDate: string | null;
  endDate: string | null;
  hoursPerDay: string;
};

// Maps each schema field to its form field (`staffId` → `staff`); `roleId` is
// fixed for the dialog, so it never surfaces as a form error.
const STAFF_ROLE_ISSUE_FIELDS: Record<
  string,
  IssueTarget<StaffRoleFormValues>
> = {
  staffId: "staff",
  startDate: "startDate",
  endDate: "endDate",
  hoursPerDay: "hoursPerDay",
};

/**
 * Staff an **open** project role from the by-project planner — the mirror image
 * of `AllocateDialog`: there the person is fixed and you search for a role, here
 * the role is fixed and you search for a person. Both write through the same
 * `allocateStaffToRole` action, which is gated on `projects.edit` and re-checks
 * inside its transaction that the role is still open and in a live state, so two
 * planners racing on the same position can't both win.
 *
 * The date range and hours/day are prefilled from the role and adjustable, as in
 * the staff-first dialog. State-driven open — the parent renders this only for
 * the targeted role.
 */
export function StaffRoleDialog({
  role,
  onClose,
  onSaved,
}: {
  role: ProjectAllocationRoleRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<StaffRoleFormValues>({
    defaultValues: {
      staff: null,
      startDate: role.startDate,
      endDate: role.endDate,
      hoursPerDay: String(role.hoursPerDay),
    },
  });

  const allocate = useAction(allocateStaffToRole, { onSuccess: onSaved });

  const onSubmit = (values: StaffRoleFormValues) => {
    const parsed = allocateStaffToRoleSchema.safeParse({
      roleId: role.id,
      staffId: values.staff?.id ?? "",
      startDate: values.startDate ?? "",
      endDate: values.endDate ?? "",
      hoursPerDay: values.hoursPerDay,
    });
    if (!parsed.success) {
      applyServerIssues(setError, parsed.error, STAFF_ROLE_ISSUE_FIELDS);
      return;
    }
    allocate.execute(parsed.data);
  };

  const what = role.description ?? PROJECT_ROLE_TYPE_LABELS[role.roleType];

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      forceMountOverlay
      title={`Staff ${what}`}
      description={`${role.projectName} · ${LINE_OF_BUSINESS_LABELS[role.lineOfBusiness]} — pick who fills this role, then adjust the dates and hours.`}
      contentClassName="max-h-[85vh] overflow-y-auto sm:max-w-lg"
    >
      {() => (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField label="Staff" error={errors.staff?.message}>
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
              className="min-w-0 flex-1"
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
              className="min-w-0 flex-1"
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
              htmlFor="staff-role-hours"
              error={errors.hoursPerDay?.message}
              className="min-w-0 flex-1"
            >
              <Input
                id="staff-role-hours"
                type="number"
                step="0.5"
                min="0"
                max="24"
                aria-invalid={Boolean(errors.hoursPerDay)}
                {...register("hoursPerDay")}
              />
            </FormField>
          </div>

          <FormDialogFooter
            serverError={allocate.result.serverError}
            submitLabel="Allocate"
            loading={allocate.isPending}
          />
        </form>
      )}
    </FormDialog>
  );
}
