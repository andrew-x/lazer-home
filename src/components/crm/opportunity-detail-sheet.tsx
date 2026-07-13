"use client";

import { IconPlus } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STATUSES,
  type OpportunitySource,
  type OpportunityStatus,
} from "@/actions/crm/createOpportunity.schema";
import type { OpportunityDetail } from "@/actions/crm/getOpportunity";
import { getOpportunityDetail } from "@/actions/crm/getOpportunityDetail";
import { searchStaff } from "@/actions/crm/searchStaff";
import { updateOpportunity } from "@/actions/crm/updateOpportunity";
import {
  type UpdateOpportunityInput,
  updateOpportunitySchema,
} from "@/actions/crm/updateOpportunity.schema";
import { applyServerIssues } from "@/components/form/apply-server-issues";
import { EnumSelect } from "@/components/form/enum-select";
import { FormField } from "@/components/form/form-field";
import { AddProjectDialog } from "@/components/projects/add-project-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_LABELS,
  type LineOfBusiness,
} from "@/lib/line-of-business";
import { requiresProject } from "@/lib/opportunity-pipeline";
import { ContactsComboboxField } from "./contacts-combobox-field";
import {
  EntityMultiCombobox,
  type EntityOption,
} from "./entity-multi-combobox";
import { SOURCE_LABELS, STATUS_SELECT_LABELS } from "./opportunity-display";

/**
 * The opportunity detail drawer: a right-side sheet opened by clicking a board
 * card. Edits status, next steps, owners, source, contacts, and referral
 * sources, and creates the project that delivers the opportunity. Company isn't
 * editable here. Detail is loaded on open via `getOpportunityDetail`; the edit
 * form is bound loosely (`useForm` + `useAction`) like the add-opportunity dialog
 * because the people fields are `{id,name}[]` comboboxes mapped to `string[]`.
 */
export function OpportunityDetailSheet({
  opportunityId,
  open,
  onOpenChange,
  canCreateProject,
}: {
  opportunityId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canCreateProject: boolean;
}) {
  const { execute: load, result, reset } = useAction(getOpportunityDetail);
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);

  useEffect(() => {
    if (open && opportunityId) {
      load({ id: opportunityId });
    } else if (!open) {
      setDetail(null);
      reset();
    }
  }, [open, opportunityId, load, reset]);

  useEffect(() => {
    if (result.data) setDetail(result.data);
  }, [result.data]);

  // Re-fetch after creating a project so the drawer's project list and the
  // delivery-stage guard reflect it — without remounting the edit form (its
  // `key` stays the same opportunity id, so in-progress edits survive).
  const refresh = useCallback(() => {
    if (opportunityId) load({ id: opportunityId });
  }, [opportunityId, load]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{detail?.name ?? "Opportunity"}</SheetTitle>
          <SheetDescription>
            {detail?.company.name ?? "Loading…"}
          </SheetDescription>
        </SheetHeader>
        {detail ? (
          <EditForm
            key={detail.id}
            detail={detail}
            canCreateProject={canCreateProject}
            onProjectCreated={refresh}
            onSaved={() => onOpenChange(false)}
          />
        ) : (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            {/* `data === null` = loaded but not found (vs `undefined` = still loading). */}
            {result.serverError || result.data === null
              ? "Couldn't load this opportunity."
              : "Loading…"}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}

type EditFormValues = {
  name: string;
  lineOfBusiness: LineOfBusiness | "";
  contacts: EntityOption[];
  owners: EntityOption[];
  source: OpportunitySource | "";
  sourceContacts: EntityOption[];
  sourceStaff: EntityOption[];
  nextSteps: string;
  status: OpportunityStatus | "";
};

// Maps a server-schema issue path to its form field, typed by
// `keyof UpdateOpportunityInput` so a new schema field can't silently drop its
// errors. `id` never surfaces as a field; route it to `name` as a harmless fallback.
const FIELD_FOR_ISSUE: Record<
  keyof UpdateOpportunityInput,
  keyof EditFormValues
> = {
  id: "name",
  name: "name",
  lineOfBusiness: "lineOfBusiness",
  contactIds: "contacts",
  ownerIds: "owners",
  source: "source",
  sourceContactIds: "sourceContacts",
  sourceStaffIds: "sourceStaff",
  nextSteps: "nextSteps",
  status: "status",
};

function EditForm({
  detail,
  canCreateProject,
  onProjectCreated,
  onSaved,
}: {
  detail: OpportunityDetail;
  canCreateProject: boolean;
  onProjectCreated: () => void;
  onSaved: () => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm<EditFormValues>({
    defaultValues: {
      name: detail.name,
      lineOfBusiness: detail.lineOfBusiness,
      contacts: detail.contacts,
      owners: detail.owners,
      source: detail.source,
      sourceContacts: detail.sourceContacts,
      sourceStaff: detail.sourceStaff,
      nextSteps: detail.nextSteps ?? "",
      status: detail.status,
    },
  });

  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectGuardError, setProjectGuardError] = useState<string | null>(
    null,
  );

  const { execute, result, isPending } = useAction(updateOpportunity, {
    onSuccess: () => onSaved(),
  });

  const source = watch("source");
  const hasProject = detail.projects.length > 0;

  const onSubmit = (values: EditFormValues) => {
    clearErrors();
    setProjectGuardError(null);

    // Client-side mirror of the server guard: don't let an opportunity advance
    // into a delivery stage without a linked project.
    if (values.status && requiresProject(values.status) && !hasProject) {
      setProjectGuardError(
        "Create a project for this opportunity before moving it to Allocating or later.",
      );
      return;
    }

    const payload = {
      id: detail.id,
      name: values.name,
      lineOfBusiness: values.lineOfBusiness,
      contactIds: values.contacts.map((c) => c.id),
      ownerIds: values.owners.map((o) => o.id),
      source: values.source,
      sourceContactIds: values.sourceContacts.map((c) => c.id),
      sourceStaffIds: values.sourceStaff.map((s) => s.id),
      nextSteps: values.nextSteps,
      status: values.status,
    };

    const parsed = updateOpportunitySchema.safeParse(payload);
    if (!parsed.success) {
      applyServerIssues(setError, parsed.error, FIELD_FOR_ISSUE);
      return;
    }

    execute(parsed.data);
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-4 overflow-y-auto px-4 pb-4"
    >
      <FormField
        label="Name"
        htmlFor="opp-edit-name"
        error={errors.name?.message}
      >
        <Input
          id="opp-edit-name"
          aria-invalid={Boolean(errors.name)}
          {...register("name")}
        />
      </FormField>

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

      <FormField label="Status" error={errors.status?.message}>
        <Controller
          control={control}
          name="status"
          render={({ field, fieldState }) => (
            <EnumSelect
              options={OPPORTUNITY_STATUSES}
              labels={STATUS_SELECT_LABELS}
              placeholder="Select a status"
              value={field.value}
              invalid={Boolean(fieldState.error)}
              onValueChange={field.onChange}
            />
          )}
        />
      </FormField>

      <FormField label="Next steps" htmlFor="opp-edit-next-steps">
        <Textarea
          id="opp-edit-next-steps"
          placeholder="What happens next?"
          {...register("nextSteps")}
        />
      </FormField>

      <FormField label="Owners">
        <Controller
          control={control}
          name="owners"
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

      <Controller
        control={control}
        name="contacts"
        render={({ field, fieldState }) => (
          <ContactsComboboxField
            label="Contacts"
            value={field.value}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />

      <FormField label="Source" error={errors.source?.message}>
        <Controller
          control={control}
          name="source"
          render={({ field, fieldState }) => (
            <EnumSelect
              options={OPPORTUNITY_SOURCES}
              labels={SOURCE_LABELS}
              placeholder="Select a source"
              value={field.value}
              invalid={Boolean(fieldState.error)}
              onValueChange={(next) => {
                field.onChange(next);
                // Referral entities only apply to their matching source.
                setValue("sourceStaff", []);
                setValue("sourceContacts", []);
                clearErrors(["sourceStaff", "sourceContacts"]);
              }}
            />
          )}
        />
      </FormField>

      {source === "staff_referral" ? (
        <FormField label="Referring staff" error={errors.sourceStaff?.message}>
          <Controller
            control={control}
            name="sourceStaff"
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
      ) : null}

      {source === "contact_referral" ? (
        <Controller
          control={control}
          name="sourceContacts"
          render={({ field, fieldState }) => (
            <ContactsComboboxField
              label="Referring contacts"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
      ) : null}

      <div className="flex flex-col gap-2 border-t pt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Project</span>
          {canCreateProject ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setProjectDialogOpen(true)}
            >
              <IconPlus />
              Create project
            </Button>
          ) : null}
        </div>
        {detail.projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No project yet. A project is required once this opportunity reaches
            Allocating.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.projects.map((project) => (
              <li key={project.id} className="text-sm">
                {project.name}
              </li>
            ))}
          </ul>
        )}
        {projectGuardError ? (
          <p className="text-sm text-destructive">{projectGuardError}</p>
        ) : null}
      </div>

      {result.serverError ? (
        <p className="text-sm text-destructive">{result.serverError}</p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="submit" loading={isPending}>
          Save
        </Button>
      </div>

      <AddProjectDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        // Launched from within the drawer (a Base UI dialog), so force its own
        // backdrop to blur the drawer behind it.
        forceMountOverlay
        opportunityId={detail.id}
        defaultCompanyId={detail.company.id}
        defaultCompanyName={detail.company.name}
        defaultLineOfBusiness={detail.lineOfBusiness}
        lockCompany
        onCreated={() => {
          setProjectGuardError(null);
          onProjectCreated();
        }}
      />
    </form>
  );
}
