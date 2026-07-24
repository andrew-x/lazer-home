"use client";

import {
  IconBriefcase,
  IconCalendar,
  IconCalendarStats,
  IconCircleCheck,
  IconClock,
} from "@tabler/icons-react";
import { useMemo } from "react";
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
import { InternalLink } from "@/components/internal-link";
import { StatCard } from "@/components/performance/stat-card";
import { PlannerGrid } from "@/components/projects/opportunity-plan/planner-grid";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { formatDate } from "@/lib/format/format";
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
import { PROJECT_ROLE_TYPE_LABELS } from "@/lib/projects/project-role-type";
import { PTO_TYPE_LABELS } from "@/lib/staff/staff-enums";

/**
 * The standalone project detail page: a meta sidebar (name, company, lines of
 * business, delivery managers) beside a main column of summary stats and three
 * tabs — a read-only Gantt timeline of the project's roles (the same planner
 * grid the opportunity's Project-plan tab uses), the roles as a table, and the
 * time off of everyone connected to the project (split upcoming/past).
 * Everything is read-only here; role editing stays in the opportunity planner.
 */
export function ProjectDetailView({
  plan,
  pto,
}: {
  plan: ProjectDetailPlan;
  pto: ProjectPtoView;
}) {
  const { project, company, roles, timeline, externalAllocations } = plan;

  const weekColumns = useMemo(() => buildWeekColumns(roles), [roles]);
  // Read-only: pass "" as the "current opportunity" so no role is marked
  // editable (a role's opportunityId can never be the empty string).
  const rows = useMemo(
    () => buildPlannerRows(roles, externalAllocations, weekColumns, ""),
    [roles, externalAllocations, weekColumns],
  );

  const lengthWeeks = weekColumns.length;
  const confirmedRange = useMemo(
    () => rangeOf(roles.filter((r) => r.status === "confirmed")),
    [roles],
  );
  const tentativeRange = useMemo(
    () => rangeOf(roles.filter((r) => r.status === "tentative")),
    [roles],
  );

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
                <h2 className="font-heading text-lg font-semibold tracking-tight">
                  {project.name}
                </h2>
                <ProjectStatusBadge status={project.status} />
              </>
            }
          />

          <SidebarSection>
            <MetaField label="Company">
              <InternalLink href={`/companies/${company.id}`}>
                {company.name}
              </InternalLink>
            </MetaField>
            <MetaField label="Line of business">
              {project.linesOfBusiness.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {project.linesOfBusiness.map((lob) => (
                    <Badge key={lob} variant="outline">
                      {LINE_OF_BUSINESS_LABELS[lob]}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </MetaField>
            <MetaField label="Delivery managers">
              {project.deliveryManagers.length > 0
                ? deliveryManagerLabel(project.deliveryManagers)
                : null}
            </MetaField>
          </SidebarSection>
        </>
      }
    >
      {/* Summary stats — the same tiles as the opportunity Project-plan tab. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Length"
          value={lengthWeeks ? `${lengthWeeks} wk` : "—"}
          hint={PROJECT_ROLE_STATUS_LABELS[project.status]}
          icon={IconCalendarStats}
        />
        <StatCard
          label="Dates"
          value={timeline ? rangeLabel(timeline) : "—"}
          hint={timeline ? yearHint(timeline) : undefined}
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
      </div>

      <Tabs defaultValue="timeline">
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="pto">Time off</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="flex flex-col gap-4">
          {rows.length === 0 ? (
            <TableEmpty>No roles on this project yet.</TableEmpty>
          ) : (
            <>
              <PlannerGrid rows={rows} weekColumns={weekColumns} />
              <ProjectPlanLegend />
            </>
          )}
        </TabsContent>

        <TabsContent value="roles">
          <DetailSection title="Roles" count={roles.length}>
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
                ]}
              >
                {rolesSorted.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell className="font-medium">
                      {role.staffName ?? (
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
                  </TableRow>
                ))}
              </DetailTable>
            )}
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
