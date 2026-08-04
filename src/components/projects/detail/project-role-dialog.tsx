"use client";

import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { createProjectRoleOnProject } from "@/actions/projects/createProjectRoleOnProject";
import { createProjectRoleOnProjectSchema } from "@/actions/projects/createProjectRoleOnProject.schema";
import { deleteProjectRoleOnProject } from "@/actions/projects/deleteProjectRoleOnProject";
import type { PlanRole } from "@/actions/projects/getOpportunityPlan";
import { updateProjectRoleOnProject } from "@/actions/projects/updateProjectRoleOnProject";
import { updateProjectRoleOnProjectSchema } from "@/actions/projects/updateProjectRoleOnProject.schema";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { applyServerIssues } from "@/components/form/apply-server-issues";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import {
  ROLE_ISSUE_FIELDS,
  RoleFields,
  type RoleFormValues,
  roleDefaultValues,
} from "@/components/projects/role-fields";
import { Button } from "@/components/ui/button";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";

/**
 * Add or edit a role from the project detail page — the delivery-side counterpart of
 * the opportunity planner's {@link RoleDialog}, over the same shared
 * {@link RoleFields}. Its actions are project-scoped, so unlike the planner's dialog
 * this one can adjust a **confirmed** role on a live engagement (re-date it, move
 * hours, swap the assignee). Gated by the caller on `canEdit` (`projects.edit`).
 *
 * Deleting is behind a confirm step, which the planner's dialog doesn't need: there,
 * only tentative draft rows can be removed, whereas here the row may be committed
 * work. When the role came from an opportunity, the confirmation says so — removing
 * it changes that opportunity's plan too.
 */
export function ProjectRoleDialog({
  projectId,
  defaultLineOfBusiness,
  existing,
  onClose,
}: {
  projectId: string;
  /**
   * Default line of business for a new role. A standalone project has no
   * opportunity to inherit from, so the caller passes the project's first derived
   * line of business, or `""` to force a choice.
   */
  defaultLineOfBusiness: LineOfBusiness | "";
  existing: PlanRole | null;
  onClose: () => void;
}) {
  const isEdit = existing !== null;
  const [removeOpen, setRemoveOpen] = useState(false);
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RoleFormValues>({
    defaultValues: roleDefaultValues(existing, defaultLineOfBusiness),
  });

  // The actions revalidate this page, so closing is all the dialog has to do.
  const create = useAction(createProjectRoleOnProject, { onSuccess: onClose });
  const update = useAction(updateProjectRoleOnProject, { onSuccess: onClose });
  const remove = useAction(deleteProjectRoleOnProject, {
    onSuccess: () => {
      setRemoveOpen(false);
      onClose();
    },
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
      // Blank means "use today's rate card" — the schema's `snapshotBillRate` fills it.
      billRate: values.billRate,
    };

    if (isEdit && existing) {
      const parsed = updateProjectRoleOnProjectSchema.safeParse({
        id: existing.id,
        projectId,
        ...shared,
      });
      if (!parsed.success) {
        applyServerIssues(setError, parsed.error, ROLE_ISSUE_FIELDS);
        return;
      }
      update.execute(parsed.data);
    } else {
      const parsed = createProjectRoleOnProjectSchema.safeParse({
        projectId,
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
      title={isEdit ? "Edit role" : "Add role"}
      description={
        isEdit
          ? "Adjust this role's staffing, dates and hours."
          : "Add a role to this project. Leave the person blank for an open position."
      }
      contentClassName="max-h-[85vh] overflow-y-auto sm:max-w-lg"
    >
      {() => (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <RoleFields
            idPrefix="project-role"
            control={control}
            register={register}
            errors={errors}
          />

          <div className="flex items-center justify-between gap-3">
            {isEdit ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={pending}
                onClick={() => setRemoveOpen(true)}
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

          {existing ? (
            <ConfirmDialog
              open={removeOpen}
              onOpenChange={(next) => {
                if (!remove.isPending) setRemoveOpen(next);
              }}
              title="Remove role?"
              description={
                existing.opportunityId
                  ? "This removes the role from the project's plan. It came from an opportunity, so that opportunity's plan changes too. Any time already logged against the project is kept."
                  : "This removes the role from the project's plan. Any time already logged against the project is kept."
              }
              confirmLabel="Remove role"
              destructive
              loading={remove.isPending}
              onConfirm={() => remove.execute({ id: existing.id, projectId })}
            />
          ) : null}
        </form>
      )}
    </FormDialog>
  );
}
