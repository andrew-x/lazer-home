"use client";

import { IconBriefcase, IconPencil, IconPlus } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { PlanRole } from "@/actions/projects/getOpportunityPlan";
import type { ProjectDeliveryNoteRow } from "@/actions/projects/getProjectDeliveryNotes";
import type { ProjectDetailPlan } from "@/actions/projects/getProjectPlan";
import type {
  ProjectPtoSpan,
  ProjectPtoView,
} from "@/actions/projects/getProjectPto";
import {
  DetailIdentity,
  DetailLayout,
  DetailSection,
  DetailTable,
  MetaField,
  SidebarSection,
  TableEmpty,
} from "@/components/crm/detail-parts";
import { EmptyCell } from "@/components/empty-cell";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { IconButton } from "@/components/icon-button";
import { InternalLink } from "@/components/internal-link";
import { BudgetSummaryPanel } from "@/components/projects/budget-summary-panel";
import {
  PlannerGrid,
  type PlannerMargins,
} from "@/components/projects/opportunity-plan/planner-grid";
import { PlanSummaryTiles } from "@/components/projects/plan-summary-tiles";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { useProjectMargin } from "@/components/projects/use-project-margin";
import { SlackChannelField } from "@/components/slack/slack-channel-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { formatDate } from "@/lib/format/format";
import {
  buildPlannerRows,
  buildWeekColumns,
} from "@/lib/projects/project-planner-grid";
import { PROJECT_ROLE_TYPE_LABELS } from "@/lib/projects/project-role-type";
import { PTO_TYPE_LABELS } from "@/lib/staff/staff-enums";
import { DeliveryManagersField } from "./delivery-managers-field";
import { DeliveryNotesPanel } from "./delivery-notes-panel";
import { ProjectCompanyField } from "./project-company-field";
import { ProjectNameField } from "./project-name-field";
import { ProjectRoleDialog } from "./project-role-dialog";

/**
 * The standalone project detail page: a meta sidebar (name, company, lines of
 * business, delivery managers) beside a main column of summary stats and four
 * tabs — a Gantt timeline of the project's roles (the same planner grid the
 * opportunity's Project-plan tab uses), the roles as a table, the log of dated
 * delivery notes, and the time off of everyone connected to the project (split
 * upcoming/past).
 *
 * This is the **delivery-side** editor of the engagement: with `projects.edit`, the
 * name, company and delivery managers are editable in place in the sidebar, and roles
 * can be added, edited and removed — from the Roles table *or* straight off the
 * timeline, both opening the same {@link ProjectRoleDialog}. That includes confirmed
 * roles, which the opportunity planner locks (see `assertProjectRoleEditable`). The
 * project's status and lines of business are derived from its roles, so neither is
 * editable.
 */
export function ProjectDetailView({
  plan,
  pto,
  notes,
  canEdit,
  slackEnabled,
  currentStaff,
}: {
  plan: ProjectDetailPlan;
  pto: ProjectPtoView;
  notes: ProjectDeliveryNoteRow[];
  canEdit: boolean;
  /** False when no Slack bot token is configured — the row hides itself. */
  slackEnabled: boolean;
  /** Defaults the Slack create dialog's invite list to the viewer. */
  currentStaff: EntityOption | null;
}) {
  const {
    project,
    company,
    roles,
    timeline,
    externalAllocations,
    costBasis,
    exchangeRates,
  } = plan;

  // null = closed; { role: null } = adding.
  const [roleDialog, setRoleDialog] = useState<{
    role: PlanRole | null;
  } | null>(null);

  const weekColumns = useMemo(() => buildWeekColumns(roles), [roles]);
  // Project scope: every role on the project is editable here, whatever its status
  // or provenance, and nothing is emphasised (there's no "other deal" to contrast
  // with — the block fill reads the role's status instead).
  const rows = useMemo(
    () =>
      buildPlannerRows(roles, externalAllocations, weekColumns, {
        scope: "project",
      }),
    [roles, externalAllocations, weekColumns],
  );

  const openRole = (roleId: string) => {
    const role = roles.find((r) => r.id === roleId);
    if (role) setRoleDialog({ role });
  };

  // Shared by the Timeline and Roles tabs so the two entry points can't drift.
  // Rendered outside each tab's empty/non-empty branch, so adding the *first*
  // role is reachable from either tab.
  const addRoleButton = canEdit ? (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setRoleDialog({ role: null })}
    >
      <IconPlus />
      Add role
    </Button>
  ) : null;

  const lengthWeeks = weekColumns.length;

  const { margin, displayCurrency, setDisplayCurrency } = useProjectMargin({
    roles,
    budget: project.budget,
    costBasis,
    exchangeRates,
  });

  // No budget means nothing to show per role; the panel explains why instead.
  const plannerMargins: PlannerMargins | undefined = project.budget.billingType
    ? {
        byRoleId: margin.byRoleId,
        currency: displayCurrency,
      }
    : undefined;

  // Roles table order: staffed first (by name), then open positions; by start
  // date within a person.
  const rolesSorted = useMemo(
    () =>
      [...roles].sort((a, b) => {
        const aStaffed = a.staffId !== null;
        const bStaffed = b.staffId !== null;
        if (aStaffed !== bStaffed) return aStaffed ? -1 : 1;
        const nameCmp = (a.staffName ?? "").localeCompare(b.staffName ?? "");
        if (nameCmp !== 0) return nameCmp;
        return a.startDate.localeCompare(b.startDate);
      }),
    [roles],
  );

  return (
    <DetailLayout
      fullWidth
      sidebar={
        <>
          <DetailIdentity
            media={
              <span className="flex size-12 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                <IconBriefcase className="size-6" />
              </span>
            }
            title={
              <>
                <ProjectNameField
                  projectId={project.id}
                  name={project.name}
                  canEdit={canEdit}
                />
                <ProjectStatusBadge status={project.status} />
              </>
            }
          />

          <SidebarSection>
            <ProjectCompanyField
              projectId={project.id}
              company={company}
              canEdit={canEdit}
            />
            {/* Derived from the project's roles, so it isn't an editable field. */}
            <MetaField label="Line of business">
              {project.linesOfBusiness.length > 0
                ? project.linesOfBusiness
                    .map((lob) => LINE_OF_BUSINESS_LABELS[lob])
                    .join(", ")
                : null}
            </MetaField>
            <DeliveryManagersField
              projectId={project.id}
              deliveryManagers={project.deliveryManagers}
              canEdit={canEdit}
            />
            {/* The project's own public delivery channel. No `onChanged`: the
                Slack actions revalidate this route, so the server re-renders. */}
            <SlackChannelField
              kind="project"
              recordId={project.id}
              sourceName={project.name}
              channel={plan.slack}
              label="Slack channel"
              canManage={canEdit}
              enabled={slackEnabled}
              currentStaff={currentStaff}
            />
          </SidebarSection>
        </>
      }
    >
      {/* Summary stats — the same tiles as the opportunity Project-plan tab.
          Delivery managers are omitted: they already have a sidebar field. Health
          comes from `notes[0]` because the read is already ordered latest-first,
          which is the same ordering the projects list derives its figure from — one
          rule, so the two surfaces can't disagree about which note is current. */}
      <PlanSummaryTiles
        roles={roles}
        timeline={timeline}
        status={project.status}
        lengthWeeks={lengthWeeks}
        health={{
          value: notes[0]?.projectHealth ?? null,
          noteDate: notes[0]?.noteDate ?? null,
        }}
      />

      {/* Above the tabs, because a budget is a property of the project rather
          than of any one tab. */}
      <BudgetSummaryPanel
        projectId={project.id}
        budget={project.budget}
        margin={margin}
        rates={exchangeRates}
        displayCurrency={displayCurrency}
        onDisplayCurrencyChange={setDisplayCurrency}
        canManage={canEdit}
      />

      <Tabs defaultValue="timeline">
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          {/* The two structural tabs first, then the narrative, then the ancillary
              time-off view. */}
          <TabsTrigger value="notes">Delivery notes</TabsTrigger>
          <TabsTrigger value="pto">Time off</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="flex flex-col gap-4">
          {addRoleButton ? (
            <div className="flex justify-end">{addRoleButton}</div>
          ) : null}
          {rows.length === 0 ? (
            <TableEmpty>No roles on this project yet.</TableEmpty>
          ) : (
            <>
              <PlannerGrid
                rows={rows}
                weekColumns={weekColumns}
                onEditRole={canEdit ? openRole : undefined}
                margins={plannerMargins}
              />
              <ProjectPlanLegend />
            </>
          )}
        </TabsContent>

        <TabsContent value="roles">
          <DetailSection
            title="Roles"
            count={roles.length}
            action={addRoleButton}
          >
            {rolesSorted.length === 0 ? (
              <TableEmpty>No roles on this project yet.</TableEmpty>
            ) : (
              <DetailTable
                headers={[
                  "Staff",
                  "Role",
                  "Line of business",
                  "Status",
                  "Dates",
                  "Hrs/day",
                  // Trailing actions column — one blank header only (DetailTable
                  // keys headers by their text).
                  ...(canEdit ? [""] : []),
                ]}
              >
                {rolesSorted.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell className="font-medium">
                      {role.staffId && role.staffName ? (
                        <InternalLink href={`/staff/${role.staffId}`}>
                          {role.staffName}
                        </InternalLink>
                      ) : (
                        <span className="text-muted-foreground">Open role</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {role.description ??
                        PROJECT_ROLE_TYPE_LABELS[role.roleType]}
                    </TableCell>
                    <TableCell>
                      {LINE_OF_BUSINESS_LABELS[role.lineOfBusiness]}
                    </TableCell>
                    <TableCell>
                      <ProjectStatusBadge status={role.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(role.startDate)} – {formatDate(role.endDate)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {role.hoursPerDay}
                    </TableCell>
                    {canEdit ? (
                      <TableCell className="w-0 text-right">
                        <IconButton
                          label={`Edit ${role.staffName ?? "open"} role`}
                          onClick={() => setRoleDialog({ role })}
                        >
                          <IconPencil />
                        </IconButton>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </DetailTable>
            )}
          </DetailSection>
        </TabsContent>

        <TabsContent value="notes">
          <DetailSection title="Delivery notes" count={notes.length}>
            <DeliveryNotesPanel
              projectId={project.id}
              notes={notes}
              canEdit={canEdit}
            />
          </DetailSection>
        </TabsContent>

        <TabsContent value="pto" className="flex flex-col gap-8">
          <PtoTable
            title="Upcoming"
            spans={pto.upcoming}
            canSeeType={pto.canSeeType}
            emptyMessage="No upcoming time off."
          />
          <PtoTable
            title="Past"
            spans={pto.past}
            canSeeType={pto.canSeeType}
            emptyMessage="No past time off."
          />
        </TabsContent>
      </Tabs>

      {roleDialog ? (
        <ProjectRoleDialog
          // Remount per target so the form picks up fresh defaults.
          key={roleDialog.role?.id ?? "create"}
          projectId={project.id}
          // A standalone project has no opportunity to inherit from; fall back to
          // the project's own first derived line of business, else force a choice.
          defaultLineOfBusiness={project.linesOfBusiness[0] ?? ""}
          existing={roleDialog.role}
          onClose={() => setRoleDialog(null)}
        />
      ) : null}
    </DetailLayout>
  );
}

/** One PTO section (Upcoming or Past). The Type column shows only to reviewers. */
function PtoTable({
  title,
  spans,
  canSeeType,
  emptyMessage,
}: {
  title: string;
  spans: ProjectPtoSpan[];
  canSeeType: boolean;
  emptyMessage: string;
}) {
  const headers = canSeeType
    ? ["Person", "Type", "Dates", "Working days"]
    : ["Person", "Dates", "Working days"];

  return (
    <DetailSection title={title} count={spans.length}>
      {spans.length === 0 ? (
        <TableEmpty>{emptyMessage}</TableEmpty>
      ) : (
        <DetailTable headers={headers}>
          {spans.map((span) => (
            <TableRow key={span.id}>
              <TableCell className="font-medium">{span.staffName}</TableCell>
              {canSeeType ? (
                <TableCell>
                  <span className="flex flex-wrap items-center gap-2">
                    {span.type ? PTO_TYPE_LABELS[span.type] : <EmptyCell />}
                    {span.isPending ? (
                      <Badge variant="outline">Pending</Badge>
                    ) : null}
                  </span>
                </TableCell>
              ) : null}
              <TableCell className="whitespace-nowrap">
                {formatDate(span.startDate)} – {formatDate(span.endDate)}
              </TableCell>
              <TableCell className="tabular-nums">{span.workingDays}</TableCell>
            </TableRow>
          ))}
        </DetailTable>
      )}
    </DetailSection>
  );
}

/**
 * Legend for the read-only project timeline. Unlike the opportunity planner
 * (which highlights "this deal"), here roles are just confirmed or tentative,
 * with the assignees' other-project commitments greyed behind them. The swatch
 * classes mirror the own/external block fills in {@link PlannerGrid}.
 */
function ProjectPlanLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-primary/40 bg-primary/10" />
        Confirmed
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-foreground/20 bg-foreground/10" />
        Tentative
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-dashed border-foreground/20 bg-foreground/[0.04]" />
        Other project
      </span>
    </div>
  );
}
