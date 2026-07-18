"use client";

import {
  IconArrowBarRight,
  IconCalendarStats,
  IconLayoutList,
  IconPencil,
  IconPlus,
} from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { associateOpportunityProject } from "@/actions/crm/associateOpportunityProject";
import { createProjectRole } from "@/actions/projects/createProjectRole";
import { createProjectRoleSchema } from "@/actions/projects/createProjectRole.schema";
import { deleteProjectRole } from "@/actions/projects/deleteProjectRole";
import { extendProjectRole } from "@/actions/projects/extendProjectRole";
import { extendProjectRoleSchema } from "@/actions/projects/extendProjectRole.schema";
import type {
  OpportunityPlan,
  PlanRole,
} from "@/actions/projects/getOpportunityPlan";
import { loadOpportunityPlan } from "@/actions/projects/loadOpportunityPlan";
import { searchProjects } from "@/actions/projects/searchProjects";
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
import { StatCard } from "@/components/performance/stat-card";
import { AddProjectDialog } from "@/components/projects/add-project-dialog";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseIsoDate } from "@/lib/format";
import type { LineOfBusiness } from "@/lib/line-of-business";
import {
  buildPlannerRows,
  buildWeekColumns,
  type PlannerRow,
  type RoleSegment,
  weekColumnLabel,
} from "@/lib/project-planner-grid";
import {
  PROJECT_ROLE_TYPE_LABELS,
  PROJECT_ROLE_TYPES,
  type ProjectRoleType,
} from "@/lib/project-role-type";
import { PROJECT_STATUS_LABELS } from "@/lib/project-status";
import { cn } from "@/lib/utils";

type CompanyRef = { id: string; name: string };

/**
 * The opportunity drawer's "Project plan" tab: a weekly, Gantt-like planner for
 * the project that delivers this opportunity. Summary stats up top; a grid of
 * roles (grouped by person) × week columns below, where a filled cell means the
 * role is active that week. This opportunity's tentative roles are editable;
 * confirmed roles and roles from other opportunities render greyed and
 * read-only. When no project is linked yet, the user can associate an existing
 * one or create a new one (both gated on `projects.edit` via `canManage`).
 */
export function OpportunityProjectPlan({
  opportunityId,
  company,
  lineOfBusiness,
  canManage,
  onProjectLinked,
}: {
  opportunityId: string;
  company: CompanyRef;
  lineOfBusiness: LineOfBusiness;
  canManage: boolean;
  /** Called after the project link changes, so the drawer can refresh too. */
  onProjectLinked: () => void;
}) {
  const { execute, result } = useAction(loadOpportunityPlan);
  const [plan, setPlan] = useState<OpportunityPlan | null>(null);

  const reload = useCallback(() => {
    execute({ opportunityId });
  }, [execute, opportunityId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (result.data) setPlan(result.data);
  }, [result.data]);

  // After a project is linked, both this tab and the drawer (its status guard)
  // must reflect it.
  const afterLink = useCallback(() => {
    reload();
    onProjectLinked();
  }, [reload, onProjectLinked]);

  if (!plan) {
    return (
      <p className="text-sm text-muted-foreground">
        {result.serverError ? "Couldn't load the project plan." : "Loading…"}
      </p>
    );
  }

  if (!plan.project) {
    return (
      <NoProjectState
        opportunityId={opportunityId}
        company={company}
        lineOfBusiness={lineOfBusiness}
        canManage={canManage}
        onLinked={afterLink}
      />
    );
  }

  return (
    <PlanEditor
      opportunityId={opportunityId}
      plan={plan}
      canManage={canManage}
      onChanged={reload}
    />
  );
}

/** The empty state: associate an existing project or create a new one. */
function NoProjectState({
  opportunityId,
  company,
  lineOfBusiness,
  canManage,
  onLinked,
}: {
  opportunityId: string;
  company: CompanyRef;
  lineOfBusiness: LineOfBusiness;
  canManage: boolean;
  onLinked: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<EntityOption | null>(null);
  const searchArgs = useMemo(() => ({ companyId: company.id }), [company.id]);

  const associate = useAction(associateOpportunityProject, {
    onSuccess: () => {
      toast.success("Project linked.");
      setSelected(null);
      onLinked();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't link the project."),
  });

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        No project yet. A delivery manager creates or links a project once this
        opportunity reaches Allocating.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        No project yet. Link an existing project for {company.name} (to extend
        it with this deal) or create a new one.
      </p>

      <FormField label="Link an existing project">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <EntityCombobox
              value={selected}
              onChange={setSelected}
              searchAction={searchProjects}
              searchArgs={searchArgs}
              placeholder={`Search ${company.name} projects…`}
            />
          </div>
          <Button
            type="button"
            disabled={!selected || associate.isPending}
            onClick={() =>
              selected &&
              associate.execute({ opportunityId, projectId: selected.id })
            }
          >
            Link
          </Button>
        </div>
      </FormField>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">or</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCreateOpen(true)}
        >
          <IconPlus />
          Create project
        </Button>
      </div>

      <AddProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        forceMountOverlay
        opportunityId={opportunityId}
        defaultCompanyId={company.id}
        defaultCompanyName={company.name}
        defaultLineOfBusiness={lineOfBusiness}
        lockCompany
        onCreated={onLinked}
      />
    </div>
  );
}

/** Summary stats + the weekly planner grid + role editing controls. */
function PlanEditor({
  opportunityId,
  plan,
  canManage,
  onChanged,
}: {
  opportunityId: string;
  plan: OpportunityPlan;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [roleDialog, setRoleDialog] = useState<
    { mode: "create" } | { mode: "edit"; role: PlanRole } | null
  >(null);
  const [extendOpen, setExtendOpen] = useState(false);

  const weekColumns = useMemo(() => buildWeekColumns(plan.roles), [plan.roles]);
  const rows = useMemo(
    () => buildPlannerRows(plan.roles, weekColumns, opportunityId),
    [plan.roles, weekColumns, opportunityId],
  );

  // The column count is exactly the timeline length in weeks (same eachWeek span).
  const lengthWeeks = weekColumns.length;

  const editRole = (roleId: string) => {
    const role = plan.roles.find((r) => r.id === roleId);
    if (role) setRoleDialog({ mode: "edit", role });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Timeline"
          value={lengthWeeks ? `${lengthWeeks} wk` : "—"}
          hint={plan.project ? PROJECT_STATUS_LABELS[plan.project.status] : ""}
          icon={IconCalendarStats}
        />
        <StatCard
          label="Roles"
          value={String(plan.roleCount)}
          icon={IconLayoutList}
        />
        <StatCard label="Project" value={plan.project?.name ?? "—"} />
      </div>

      {/* Planner grid */}
      {rows.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          No roles yet.
          {canManage ? " Add one to start planning this project." : null}
        </p>
      ) : (
        <PlannerGrid
          rows={rows}
          weekColumns={weekColumns}
          onEditRole={canManage ? editRole : undefined}
        />
      )}

      {/* Legend + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PlannerLegend />
        {canManage ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={plan.roles.length === 0}
              onClick={() => setExtendOpen(true)}
            >
              <IconArrowBarRight />
              Extend a role
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setRoleDialog({ mode: "create" })}
            >
              <IconPlus />
              Add role
            </Button>
          </div>
        ) : null}
      </div>

      {roleDialog ? (
        <RoleDialog
          key={roleDialog.mode === "edit" ? roleDialog.role.id : "create"}
          opportunityId={opportunityId}
          existing={roleDialog.mode === "edit" ? roleDialog.role : null}
          onClose={() => setRoleDialog(null)}
          onSaved={() => {
            setRoleDialog(null);
            onChanged();
          }}
        />
      ) : null}

      {extendOpen ? (
        <ExtendDialog
          opportunityId={opportunityId}
          roles={plan.roles}
          onClose={() => setExtendOpen(false)}
          onSaved={() => {
            setExtendOpen(false);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

/** The block style for a week cell, by the covering segment's state. */
function segmentClass(segment: RoleSegment): string {
  if (segment.editable) return "bg-secondary border border-border";
  if (segment.status === "confirmed") return "bg-foreground/25";
  return "bg-foreground/10"; // tentative, from another opportunity
}

function PlannerGrid({
  rows,
  weekColumns,
  onEditRole,
}: {
  rows: PlannerRow[];
  weekColumns: string[];
  onEditRole?: (roleId: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <th className="sticky left-0 z-10 min-w-56 bg-background px-3 py-2 text-left font-medium">
              Role
            </th>
            {weekColumns.map((week) => (
              <th
                key={week}
                className="min-w-14 px-1 py-2 text-center text-xs font-medium text-muted-foreground"
              >
                {weekColumnLabel(week)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b last:border-b-0">
              <td className="sticky left-0 z-10 bg-background px-3 py-2 align-top">
                <div className="font-medium">{row.label}</div>
                <div className="text-xs text-muted-foreground">
                  {row.sublabel}
                  {row.sublabel ? " · " : ""}
                  {allocationLabel(row)}
                </div>
                {/* An explicit edit control per editable segment — the sole edit
                    surface, so a segment fully contained by another (same
                    person) is still reachable. */}
                {onEditRole ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.segments
                      .filter((s) => s.editable)
                      .map((s) => (
                        <button
                          key={s.roleId}
                          type="button"
                          onClick={() => onEditRole(s.roleId)}
                          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                        >
                          <IconPencil className="size-3" />
                          {shortRange(s.startDate, s.endDate)}
                        </button>
                      ))}
                  </div>
                ) : null}
              </td>
              {weekColumns.map((week, i) => {
                const segment = row.active[i]
                  ? coveringSegment(row, week)
                  : null;
                return (
                  <td key={week} className="px-0.5 py-2">
                    {segment ? (
                      <BlockCell segment={segment} />
                    ) : (
                      <div className="h-6" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A single filled week cell — a visual block; editing is via the label controls. */
function BlockCell({ segment }: { segment: RoleSegment }) {
  return (
    <div
      className={cn("h-6 w-full rounded-none", segmentClass(segment))}
      title={`${PROJECT_ROLE_TYPE_LABELS[segment.roleType]} · ${segment.hoursPerDay}h/day${segment.status === "confirmed" ? " · confirmed" : ""}`}
    />
  );
}

/** "Aug 3 – Aug 16" from two ISO dates, for the per-segment edit control. */
function shortRange(start: string, end: string): string {
  const fmt = (d: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(parseIsoDate(d));
  return `${fmt(start)} – ${fmt(end)}`;
}

/** The distinct daily-hours across a row's segments, e.g. "8h/day" or "8/4h/day". */
function allocationLabel(row: PlannerRow): string {
  const hours: number[] = [];
  for (const s of row.segments) {
    if (!hours.includes(s.hoursPerDay)) hours.push(s.hoursPerDay);
  }
  return `${hours.join("/")}h/day`;
}

/**
 * A segment of `row` covering `week`, for styling that week's cell. Prefers an
 * editable segment when several overlap, so an editable role contained within a
 * greyed one still reads as "this deal" on its own weeks.
 */
function coveringSegment(row: PlannerRow, week: string): RoleSegment | null {
  const covering = row.segments.filter(
    (s) => week >= s.startWeek && week <= s.endWeek,
  );
  return covering.find((s) => s.editable) ?? covering[0] ?? null;
}

function PlannerLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="size-3 rounded-none border border-border bg-secondary" />
        This deal (editable)
      </span>
      <span className="flex items-center gap-1">
        <span className="size-3 rounded-none bg-foreground/25" />
        Confirmed
      </span>
      <span className="flex items-center gap-1">
        <span className="size-3 rounded-none bg-foreground/10" />
        Other deal
      </span>
    </div>
  );
}

// --- Role create/edit dialog ------------------------------------------------

type RoleFormValues = {
  staff: EntityOption | null;
  name: string;
  roleType: ProjectRoleType | "";
  startDate: string | null;
  endDate: string | null;
  hoursPerDay: string;
};

// Maps each role schema field to its form field (note `staffId` → `staff`); the
// server-controlled `id`/`opportunityId` never surface as form errors.
const ROLE_ISSUE_FIELDS: Record<string, IssueTarget<RoleFormValues>> = {
  staffId: "staff",
  name: "name",
  roleType: "roleType",
  startDate: "startDate",
  endDate: "endDate",
  hoursPerDay: "hoursPerDay",
};

function RoleDialog({
  opportunityId,
  existing,
  onClose,
  onSaved,
}: {
  opportunityId: string;
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
      name: existing?.name ?? "",
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
      name: values.name,
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
              label="Role type"
              error={errors.roleType?.message}
              className="flex-1"
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
            <FormField
              label="Name (optional)"
              htmlFor="role-name"
              error={errors.name?.message}
              className="flex-1"
            >
              <Input
                id="role-name"
                placeholder="Senior Backend Engineer"
                aria-invalid={Boolean(errors.name)}
                {...register("name")}
              />
            </FormField>
          </div>

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
              className="flex-1"
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
              className="flex-1"
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
              className="flex-1"
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

// --- Extend dialog ----------------------------------------------------------

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
    role.staffName ?? role.name ?? PROJECT_ROLE_TYPE_LABELS[role.roleType];
  return `${who} · ${role.startDate} → ${role.endDate}`;
}

function ExtendDialog({
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
      description="Continue an existing role's staff allocation with a new tentative segment tied to this opportunity."
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
                  onValueChange={field.onChange}
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
              className="flex-1"
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
              className="flex-1"
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
              className="flex-1"
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
