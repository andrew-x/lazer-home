"use client";

import { useAction } from "next-safe-action/hooks";
import { Controller, useForm } from "react-hook-form";
import { extendProjectRole } from "@/actions/projects/extendProjectRole";
import { extendProjectRoleSchema } from "@/actions/projects/extendProjectRole.schema";
import type { PlanRole } from "@/actions/projects/getOpportunityPlan";
import {
  applyServerIssues,
  type IssueTarget,
} from "@/components/form/apply-server-issues";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROJECT_ROLE_TYPE_LABELS } from "@/lib/projects/project-role-type";

type ExtendFormValues = {
  sourceRoleId: string;
  startDate: string | null;
  endDate: string | null;
  hoursPerDay: string;
};

const EXTEND_ISSUE_FIELDS: Record<string, IssueTarget<ExtendFormValues>> = {
  sourceRoleId: "sourceRoleId",
  startDate: "startDate",
  endDate: "endDate",
  hoursPerDay: "hoursPerDay",
};

/** A readable label for a role in the "extend" source picker. */
function roleOptionLabel(role: PlanRole): string {
  const who =
    role.staffName ??
    role.description ??
    PROJECT_ROLE_TYPE_LABELS[role.roleType];
  return `${who} · ${role.startDate} → ${role.endDate}`;
}

export function ExtendDialog({
  opportunityId,
  roles,
  onClose,
  onSaved,
}: {
  opportunityId: string;
  roles: PlanRole[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<ExtendFormValues>({
    defaultValues: {
      sourceRoleId: "",
      startDate: null,
      endDate: null,
      hoursPerDay: "8",
    },
  });

  const extend = useAction(extendProjectRole, { onSuccess: onSaved });

  const onSubmit = (values: ExtendFormValues) => {
    const parsed = extendProjectRoleSchema.safeParse({
      sourceRoleId: values.sourceRoleId,
      opportunityId,
      startDate: values.startDate ?? "",
      endDate: values.endDate ?? "",
      hoursPerDay: values.hoursPerDay,
    });
    if (!parsed.success) {
      applyServerIssues(setError, parsed.error, EXTEND_ISSUE_FIELDS);
      return;
    }
    extend.execute(parsed.data);
  };

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      forceMountOverlay
      title="Extend a role"
      description="Continue a confirmed role's staff allocation with a new tentative segment tied to this opportunity."
      contentClassName="max-h-[85vh] overflow-y-auto sm:max-w-lg"
    >
      {() => (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField
            label="Role to extend"
            error={errors.sourceRoleId?.message}
          >
            <Controller
              control={control}
              name="sourceRoleId"
              render={({ field }) => (
                <Select
                  value={field.value || null}
                  onValueChange={(next) => {
                    field.onChange(next);
                    // Continue the allocation seamlessly: default the new
                    // segment's start to where the source role ends. Still
                    // editable afterward.
                    const source = roles.find((r) => r.id === next);
                    if (source) setValue("startDate", source.endDate);
                  }}
                >
                  <SelectTrigger aria-label="Role to extend">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {roleOptionLabel(role)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              htmlFor="extend-hours"
              error={errors.hoursPerDay?.message}
              className="flex-1 min-w-0"
            >
              <Input
                id="extend-hours"
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
            serverError={extend.result.serverError}
            submitLabel="Extend"
            loading={extend.isPending}
          />
        </form>
      )}
    </FormDialog>
  );
}
