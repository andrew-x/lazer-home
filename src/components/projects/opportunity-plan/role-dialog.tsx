"use client";

import { useAction } from "next-safe-action/hooks";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { createProjectRole } from "@/actions/projects/createProjectRole";
import { createProjectRoleSchema } from "@/actions/projects/createProjectRole.schema";
import { deleteProjectRole } from "@/actions/projects/deleteProjectRole";
import type { PlanRole } from "@/actions/projects/getOpportunityPlan";
import { updateProjectRole } from "@/actions/projects/updateProjectRole";
import { updateProjectRoleSchema } from "@/actions/projects/updateProjectRole.schema";
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
 * Add or edit one of *this opportunity's* tentative roles. The deal-side role
 * editor: every action here is opportunity-scoped, so `assertRoleEditable` keeps it
 * to tentative roles tagged with this opportunity. The project detail page has its
 * own delivery-side editor (`ProjectRoleDialog`) over the same fields.
 */
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
    defaultValues: roleDefaultValues(existing, defaultLineOfBusiness),
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
      // Blank means "use today's rate card" — the schema's `snapshotBillRate` fills it.
      billRate: values.billRate,
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
          <RoleFields
            idPrefix="role"
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
