"use client";

import {
  IconArrowBarRight,
  IconCalendar,
  IconCalendarStats,
  IconCircleCheck,
  IconClock,
  IconCopy,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { associateOpportunityProject } from "@/actions/crm/associateOpportunityProject";
import { assignRoleStaff } from "@/actions/projects/assignRoleStaff";
import { bumpProjectRoles } from "@/actions/projects/bumpProjectRoles";
import { createProjectFromOpportunity } from "@/actions/projects/createProjectFromOpportunity";
import { deleteProjectRoles } from "@/actions/projects/deleteProjectRoles";
import { duplicateProjectRoles } from "@/actions/projects/duplicateProjectRoles";
import type {
  OpportunityPlan,
  PlanRole,
} from "@/actions/projects/getOpportunityPlan";
import { loadOpportunityPlan } from "@/actions/projects/loadOpportunityPlan";
import { searchProjects } from "@/actions/projects/searchProjects";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { FormDialog, FormDialogFooter } from "@/components/form/form-dialog";
import { FormField } from "@/components/form/form-field";
import { InternalLink } from "@/components/internal-link";
import { StatCard } from "@/components/performance/stat-card";
import { EditProjectDialog } from "@/components/projects/opportunity-plan/edit-project-dialog";
import { ExtendDialog } from "@/components/projects/opportunity-plan/extend-dialog";
import {
  PlannerGrid,
  PlannerLegend,
} from "@/components/projects/opportunity-plan/planner-grid";
import { RoleDialog } from "@/components/projects/opportunity-plan/role-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LINE_OF_BUSINESS_LABELS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import {
  deliveryManagerLabel,
  rangeLabel,
  rangeOf,
  yearHint,
} from "@/lib/projects/plan-summary";
import {
  buildPlannerRows,
  buildWeekColumns,
} from "@/lib/projects/project-planner-grid";
import { PROJECT_ROLE_STATUS_LABELS } from "@/lib/projects/project-role-status";

type CompanyRef = { id: string; name: string };

/**
 * The opportunity drawer's "Project plan" tab: a weekly, Gantt-like planner for
 * the project that delivers this opportunity. Summary stats up top; a grid of
 * one row per role × week columns below, each row carrying a Staff column and
 * (when staffed) the assignee's other-project commitments greyed behind this
 * role's load. This opportunity's tentative roles are editable — selectable for
 * bulk delete/duplicate/bump and inline staff assignment; confirmed roles and
 * roles from other opportunities render greyed and read-only. When no project is
 * linked yet, the user can associate an existing one or create a new one (both
 * gated on `projects.edit` via `canManage`).
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
        canManage={canManage}
        onLinked={afterLink}
      />
    );
  }

  return (
    <PlanEditor
      opportunityId={opportunityId}
      plan={plan}
      lineOfBusiness={lineOfBusiness}
      canManage={canManage}
      onChanged={reload}
      onProjectRemoved={afterLink}
    />
  );
}

/** The empty state: associate an existing project or create a new one. */
function NoProjectState({
  opportunityId,
  company,
  canManage,
  onLinked,
}: {
  opportunityId: string;
  company: CompanyRef;
  canManage: boolean;
  onLinked: () => void;
}) {
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

  // One click — the new project inherits the opportunity's name and company.
  const create = useAction(createProjectFromOpportunity, {
    onSuccess: () => {
      toast.success("Project created.");
      onLinked();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't create the project."),
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
          disabled={create.isPending}
          onClick={() => create.execute({ opportunityId })}
        >
          <IconPlus />
          Create project
        </Button>
      </div>
    </div>
  );
}

/** Summary stats + the weekly planner grid + role editing controls. */
function PlanEditor({
  opportunityId,
  plan,
  lineOfBusiness,
  canManage,
  onChanged,
  onProjectRemoved,
}: {
  opportunityId: string;
  plan: OpportunityPlan;
  /** The opportunity's line of business — the default for new roles. */
  lineOfBusiness: LineOfBusiness;
  canManage: boolean;
  onChanged: () => void;
  /** Called after the project is removed/detached, so the drawer refreshes too. */
  onProjectRemoved: () => void;
}) {
  const [roleDialog, setRoleDialog] = useState<
    { mode: "create" } | { mode: "edit"; role: PlanRole } | null
  >(null);
  const [extendOpen, setExtendOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [bumpOpen, setBumpOpen] = useState(false);
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(
    () => new Set(),
  );

  const weekColumns = useMemo(() => buildWeekColumns(plan.roles), [plan.roles]);
  const rows = useMemo(
    () =>
      buildPlannerRows(
        plan.roles,
        plan.externalAllocations,
        weekColumns,
        opportunityId,
      ),
    [plan.roles, plan.externalAllocations, weekColumns, opportunityId],
  );

  const editableRoleIds = useMemo(
    () => rows.filter((r) => r.editable).map((r) => r.roleId),
    [rows],
  );

  // You can only extend a confirmed role (continue a committed allocation).
  const extendableRoles = useMemo(
    () => plan.roles.filter((r) => r.status === "confirmed"),
    [plan.roles],
  );

  // The column count is exactly the timeline length in weeks (same eachWeek span).
  const lengthWeeks = weekColumns.length;

  // Confirmed vs. tentative spans — shown as separate tiles once anything is
  // committed, so the locked-in timeline reads apart from the proposed one.
  const confirmedRange = useMemo(
    () => rangeOf(plan.roles.filter((r) => r.status === "confirmed")),
    [plan.roles],
  );
  const tentativeRange = useMemo(
    () => rangeOf(plan.roles.filter((r) => r.status === "tentative")),
    [plan.roles],
  );

  const clearSelection = useCallback(() => setSelectedRoleIds(new Set()), []);
  const afterBulk = useCallback(() => {
    clearSelection();
    onChanged();
  }, [clearSelection, onChanged]);

  const assign = useAction(assignRoleStaff, {
    onSuccess: () => {
      toast.success("Staff assigned.");
      onChanged();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't assign staff."),
  });
  const remove = useAction(deleteProjectRoles, {
    onSuccess: ({ data }) => {
      const n = data?.count ?? 0;
      toast.success(`Deleted ${n} role${n === 1 ? "" : "s"}.`);
      afterBulk();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't delete the roles."),
  });
  const duplicate = useAction(duplicateProjectRoles, {
    onSuccess: ({ data }) => {
      const n = data?.ids.length ?? 0;
      toast.success(`Duplicated ${n} role${n === 1 ? "" : "s"}.`);
      afterBulk();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't duplicate the roles."),
  });
  const bump = useAction(bumpProjectRoles, {
    onSuccess: () => {
      toast.success("Timelines bumped.");
      setBumpOpen(false);
      afterBulk();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Couldn't bump the timelines."),
  });

  const editRole = (roleId: string) => {
    const role = plan.roles.find((r) => r.id === roleId);
    if (role) setRoleDialog({ mode: "edit", role });
  };

  const toggleSelect = (roleId: string) =>
    setSelectedRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  const toggleSelectAll = () =>
    setSelectedRoleIds((prev) => {
      const allSelected =
        editableRoleIds.length > 0 &&
        editableRoleIds.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(editableRoleIds);
    });

  const selectedRoleIdList = useMemo(
    () => [...selectedRoleIds],
    [selectedRoleIds],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Summary — project name on its own line, then the stat tiles. */}
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="font-heading text-base font-medium">
              {plan.project ? (
                <InternalLink href={`/projects/${plan.project.id}`}>
                  {plan.project.name}
                </InternalLink>
              ) : (
                "—"
              )}
            </h3>
            {plan.project && plan.project.linesOfBusiness.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {plan.project.linesOfBusiness.map((lob) => (
                  <Badge key={lob} variant="outline">
                    {LINE_OF_BUSINESS_LABELS[lob]}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
          {canManage && plan.project ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setEditOpen(true)}
            >
              <IconPencil />
              Edit project
            </Button>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Length"
            value={lengthWeeks ? `${lengthWeeks} wk` : "—"}
            hint={
              plan.project
                ? PROJECT_ROLE_STATUS_LABELS[plan.project.status]
                : ""
            }
            icon={IconCalendarStats}
          />
          <StatCard
            label="Dates"
            value={plan.timeline ? rangeLabel(plan.timeline) : "—"}
            hint={plan.timeline ? yearHint(plan.timeline) : undefined}
            icon={IconCalendar}
          />
          {confirmedRange ? (
            <StatCard
              label="Confirmed"
              value={rangeLabel(confirmedRange)}
              hint={yearHint(confirmedRange)}
              icon={IconCircleCheck}
            />
          ) : null}
          {confirmedRange && tentativeRange ? (
            <StatCard
              label="Tentative"
              value={rangeLabel(tentativeRange)}
              hint={yearHint(tentativeRange)}
              icon={IconClock}
            />
          ) : null}
          <StatCard
            label="Delivery managers"
            value={deliveryManagerLabel(plan.project?.deliveryManagers ?? [])}
            icon={IconUsers}
          />
        </div>
      </div>

      {/* Bulk actions on the selected editable roles. */}
      {canManage && selectedRoleIds.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{selectedRoleIds.size} selected</span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 whitespace-nowrap"
              onClick={() => setBumpOpen(true)}
            >
              <IconArrowBarRight />
              Bump timelines
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={duplicate.isPending}
              onClick={() =>
                duplicate.execute({
                  opportunityId,
                  roleIds: selectedRoleIdList,
                })
              }
            >
              <IconCopy />
              Duplicate
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() =>
                remove.execute({ opportunityId, roleIds: selectedRoleIdList })
              }
            >
              <IconTrash />
              Delete
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearSelection}
            >
              Clear
            </Button>
          </div>
        </div>
      ) : null}

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
          selectedRoleIds={canManage ? selectedRoleIds : undefined}
          onToggleSelect={canManage ? toggleSelect : undefined}
          onToggleSelectAll={canManage ? toggleSelectAll : undefined}
          onAssignStaff={
            canManage
              ? (roleId, staffId) =>
                  assign.execute({ roleId, opportunityId, staffId })
              : undefined
          }
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
              disabled={extendableRoles.length === 0}
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
          defaultLineOfBusiness={lineOfBusiness}
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
          roles={extendableRoles}
          onClose={() => setExtendOpen(false)}
          onSaved={() => {
            setExtendOpen(false);
            onChanged();
          }}
        />
      ) : null}

      {editOpen && plan.project ? (
        <EditProjectDialog
          project={plan.project}
          opportunityId={opportunityId}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            onChanged();
          }}
          onRemoved={onProjectRemoved}
        />
      ) : null}

      {bumpOpen ? (
        <BumpRolesDialog
          open={bumpOpen}
          onOpenChange={setBumpOpen}
          count={selectedRoleIds.size}
          pending={bump.isPending}
          onConfirm={(weeks) =>
            bump.execute({ opportunityId, roleIds: selectedRoleIdList, weeks })
          }
        />
      ) : null}
    </div>
  );
}

/** Confirm-dialog for the bulk "Bump timelines by N weeks" action. */
function BumpRolesDialog({
  open,
  onOpenChange,
  count,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  pending: boolean;
  onConfirm: (weeks: number) => void;
}) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Bump timelines"
      description={`Shift ${count} role${count === 1 ? "" : "s"} by whole weeks — start and end move together.`}
    >
      {() => <BumpRolesForm pending={pending} onConfirm={onConfirm} />}
    </FormDialog>
  );
}

function BumpRolesForm({
  pending,
  onConfirm,
}: {
  pending: boolean;
  onConfirm: (weeks: number) => void;
}) {
  const [weeks, setWeeks] = useState("1");
  const parsed = Number(weeks);
  const valid = weeks.trim() !== "" && Number.isInteger(parsed) && parsed !== 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onConfirm(parsed);
      }}
      className="flex flex-col gap-4"
    >
      <FormField
        label="Weeks"
        error={valid ? undefined : "Enter a non-zero whole number."}
      >
        <Input
          type="number"
          step={1}
          value={weeks}
          onChange={(e) => setWeeks(e.target.value)}
          aria-invalid={!valid}
        />
        <p className="text-xs text-muted-foreground">
          Use a negative number to pull work earlier.
        </p>
      </FormField>
      <FormDialogFooter submitLabel="Bump" loading={pending} />
    </form>
  );
}
