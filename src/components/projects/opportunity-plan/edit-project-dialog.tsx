"use client";

import { IconTrash } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { PlanProject } from "@/actions/projects/getOpportunityPlan";
import { removeProjectFromOpportunity } from "@/actions/projects/removeProjectFromOpportunity";
import { searchStaff } from "@/actions/projects/searchStaff";
import { updateProject } from "@/actions/projects/updateProject";
import { updateProjectSchema } from "@/actions/projects/updateProject.schema";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  applyServerIssues,
  type IssueTarget,
} from "@/components/form/apply-server-issues";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "@/components/form/entity-multi-combobox";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type EditProjectFormValues = {
  name: string;
  deliveryManagers: EntityOption[];
};

const EDIT_PROJECT_ISSUE_FIELDS: Record<
  string,
  IssueTarget<EditProjectFormValues>
> = {
  name: "name",
  deliveryManagerIds: "deliveryManagers",
  // Server-controlled; never a form field.
  projectId: "name",
};

/**
 * Edit the project's name and delivery managers, or remove it from this
 * opportunity. A project's status and lines of business are derived from its
 * roles, so they aren't edited here; roles are managed separately by the planner
 * grid below. Gated by the caller on `canManage` (`projects.edit`).
 */
export function EditProjectDialog({
  project,
  opportunityId,
  onClose,
  onSaved,
  onRemoved,
}: {
  project: PlanProject;
  opportunityId: string;
  onClose: () => void;
  onSaved: () => void;
  /** Called after the project is removed/detached, so the drawer refreshes. */
  onRemoved: () => void;
}) {
  const [removeOpen, setRemoveOpen] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<EditProjectFormValues>({
    defaultValues: {
      name: project.name,
      deliveryManagers: project.deliveryManagers.map((m) => ({
        id: m.id,
        name: m.name,
      })),
    },
  });

  const update = useAction(updateProject, {
    onSuccess: () => {
      toast.success("Project updated.");
      onSaved();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't update the project."),
  });

  const remove = useAction(removeProjectFromOpportunity, {
    onSuccess: ({ data }) => {
      setRemoveOpen(false);
      toast.success(
        data?.deletedProject ? "Project deleted." : "Project removed.",
      );
      onRemoved();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't remove the project."),
  });

  const onSubmit = (values: EditProjectFormValues) => {
    const parsed = updateProjectSchema.safeParse({
      projectId: project.id,
      name: values.name,
      deliveryManagerIds: values.deliveryManagers.map((d) => d.id),
    });
    if (!parsed.success) {
      applyServerIssues(setError, parsed.error, EDIT_PROJECT_ISSUE_FIELDS);
      return;
    }
    update.execute(parsed.data);
  };

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      forceMountOverlay
      title="Edit project"
      description="Update the project's name and delivery managers. Status and lines of business are derived from its roles, edited in the planner below."
      contentClassName="max-h-[85vh] overflow-y-auto sm:max-w-lg"
    >
      {() => (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField
            label="Name"
            htmlFor="edit-project-name"
            error={errors.name?.message}
          >
            <Input
              id="edit-project-name"
              aria-invalid={Boolean(errors.name)}
              {...register("name")}
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

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={remove.isPending}
              onClick={() => setRemoveOpen(true)}
            >
              <IconTrash />
              Remove project
            </Button>
            <FormDialogFooter
              serverError={update.result.serverError}
              submitLabel="Save"
              loading={update.isPending}
            />
          </div>

          <ConfirmDialog
            open={removeOpen}
            onOpenChange={(next) => {
              if (!remove.isPending) setRemoveOpen(next);
            }}
            title="Remove project?"
            description="This removes the project from this opportunity. If the project holds only this opportunity's roles (and no other opportunity uses it), the whole project is deleted; otherwise this opportunity's roles are removed and the project is unlinked."
            confirmLabel="Remove project"
            destructive
            loading={remove.isPending}
            onConfirm={() => remove.execute({ opportunityId })}
          />
        </form>
      )}
    </FormDialog>
  );
}
