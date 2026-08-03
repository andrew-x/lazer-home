import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { ScrollList } from "@/components/home/scroll-list";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import type { OrgUpcomingRole, ProjectRoleGroup } from "@/lib/home/org-status";
import { PROJECT_ROLE_TYPE_LABELS } from "@/lib/projects/project-role-type";

/**
 * Roles starting or ending soon, **grouped by project**.
 *
 * One component, rendered twice — as "Starting soon" and "Ending soon". They were
 * one card with two lists, which read as a single mixed feed and buried whichever
 * half was shorter; they're separate cards because they prompt different work
 * (find people vs. find their next engagement) and are often read by different
 * people.
 *
 * **Grouped by project, not a flat list of roles.** Roles are stored one per seat,
 * but they're sold and staffed per engagement: three engineers rolling onto one
 * project in the same week is *one* thing to plan for, and a flat list interleaves
 * unrelated projects so that shape is invisible. The project is the heading; the
 * people (or unfilled seats) sit under it.
 *
 * The list scrolls rather than truncating (see {@link ScrollList}) — with a taller
 * cap than the flat person lists, since a group is several rows tall and cutting one
 * mid-project would hide seats under a heading you can already see. The header keeps
 * the project and role totals the old "N more" line carried.
 */
export function ProjectRolesPanel({
  title,
  groups,
  horizonDays,
  emptyLabel,
}: {
  title: string;
  groups: ProjectRoleGroup[];
  horizonDays: number;
  /** Verb for the empty state, e.g. "starts" / "ends". */
  emptyLabel: string;
}) {
  const roles = groups.reduce((sum, group) => sum + group.roles.length, 0);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
        {groups.length > 0 ? (
          <CardAction className="text-xs text-muted-foreground">
            {groups.length} {groups.length === 1 ? "project" : "projects"} ·{" "}
            {roles} {roles === 1 ? "role" : "roles"}
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <EmptyState>
            Nothing {emptyLabel} in the next {horizonDays} days.
          </EmptyState>
        ) : (
          <ScrollList className="max-h-80 gap-4">
            {groups.map((group) => (
              <ProjectGroup key={group.projectId} group={group} />
            ))}
          </ScrollList>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectGroup({ group }: { group: ProjectRoleGroup }) {
  const unfilled = group.roles.filter((role) => role.staffId === null).length;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <Link
          href={`/projects/${group.projectId}`}
          className="min-w-0 truncate text-sm font-medium hover:underline"
        >
          {group.projectName}
        </Link>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {group.inDays === 0 ? "today" : `in ${group.inDays}d`}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {LINE_OF_BUSINESS_LABELS[group.lineOfBusiness]} · {group.roles.length}{" "}
        {group.roles.length === 1 ? "role" : "roles"}
        {unfilled > 0 ? ` · ${unfilled} unfilled` : ""}
      </p>
      <div className="flex flex-col gap-0.5 pt-0.5 pl-3">
        {group.roles.map((role) => (
          <RoleLine key={`${role.roleId}-${role.kind}`} role={role} />
        ))}
      </div>
    </div>
  );
}

/**
 * An unfilled seat leads with its discipline instead of a name — the discipline is
 * what has to be found, so it's the actionable half.
 */
function RoleLine({ role }: { role: OrgUpcomingRole }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="flex min-w-0 items-center gap-1.5">
        {role.staffId ? (
          <>
            <Link
              href={`/staff/${role.staffId}`}
              className="truncate hover:underline"
            >
              {role.staffName}
            </Link>
            <span className="shrink-0 text-xs text-muted-foreground">
              {PROJECT_ROLE_TYPE_LABELS[role.roleType]}
            </span>
          </>
        ) : (
          <>
            <span className="truncate">
              {PROJECT_ROLE_TYPE_LABELS[role.roleType]}
            </span>
            <Badge variant="secondary" className="shrink-0 font-normal">
              Unfilled
            </Badge>
          </>
        )}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {role.inDays === 0 ? "today" : `in ${role.inDays}d`}
      </span>
    </div>
  );
}
