"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { ProjectListItem } from "@/actions/projects/getProjectsList";
import { SortHeaderButton } from "@/components/form/sort-header";
import { InternalLink } from "@/components/internal-link";
import { HealthBar } from "@/components/projects/health-bar";
import { useProjectsCurrency } from "@/components/projects/projects-currency";
import { ROOMY_TABLE } from "@/components/table-density";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildListHref, type SearchParams } from "@/lib/core/list-href";
import type { SortDirection } from "@/lib/core/sort";
import { cn } from "@/lib/core/utils";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { aggregateMoneyFormatters } from "@/lib/format/currency";
import {
  formatDateRange,
  formatPercent,
  formatShortDate,
  parseIsoDate,
} from "@/lib/format/format";
import {
  PROJECT_FLAG_LABELS,
  PROJECT_FLAG_VARIANTS,
} from "@/lib/projects/project-flags";
import { marginAmountTone } from "@/lib/projects/project-margin";
import {
  nextSortDirection,
  PROJECTS_PAGE_KEY,
  type ProjectSortKey,
} from "@/lib/projects/projects-list-sort";

/** The list's active order, as the page parsed it out of the URL. */
export type ProjectsSort = { key: ProjectSortKey; dir: SortDirection };

/**
 * The projects list as a dense, sortable table — one project per row, identity on
 * the left, the risk tags next, and the two figures right-aligned at the edge so
 * they stack into comparable columns.
 *
 * This replaced a grid of `ProjectCard`s ([ADR 0060](../../../docs/decisions/0060-projects-list-as-a-sortable-table.md),
 * superseding [ADR 0057](../../../docs/decisions/0057-projects-list-margin-and-derived-flags.md) §7).
 * The cards repeated six field labels per project and started every value at a
 * different x-position, which made the one thing a list is for — comparing — the one
 * thing it couldn't do. What ADR 0057 got right survives: **the badge column still
 * means "look at this one"**, carrying only derived risk flags. Status is the tab
 * above the table now, not a badge, and line of business stays plain text.
 *
 * A client component for two reasons: the Margin figure follows the list's currency
 * context, and the sortable headers navigate. **Sorting is server-side** — the list
 * is paginated, so sorting the twenty rows in hand would reorder a page while
 * presenting itself as having ordered the list.
 */
export function ProjectsTable({
  projects,
  params,
  sort,
  showMargin,
}: {
  projects: ProjectListItem[];
  params: SearchParams;
  sort: ProjectsSort;
  /**
   * Whether the viewer may see plan margin (`projects.viewMargin`). False omits the
   * column **and its header** rather than blanking the cells — see `MarginCell`.
   */
  showMargin: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className={ROOMY_TABLE}>
        <TableHeader>
          <TableRow>
            <SortableHead
              column="name"
              label="Project"
              params={params}
              sort={sort}
            />
            <SortableHead
              column="client"
              label="Client"
              params={params}
              sort={sort}
            />
            <TableHead>Risk</TableHead>
            <TableHead>Line of business</TableHead>
            <TableHead>Delivery</TableHead>
            <TableHead className="text-right">Roles</TableHead>
            <SortableHead
              column="endDate"
              label="Dates"
              params={params}
              sort={sort}
            />
            <SortableHead
              column="health"
              label="Health"
              params={params}
              sort={sort}
              align="right"
            />
            {showMargin ? (
              <SortableHead
                column="margin"
                label="Margin"
                params={params}
                sort={sort}
                align="right"
              />
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((project) => (
            <TableRow key={project.id}>
              <Cell className="max-w-64 font-medium">
                <InternalLink
                  href={`/projects/${project.id}`}
                  className="block truncate"
                  title={project.name}
                >
                  {project.name}
                </InternalLink>
              </Cell>
              <Cell className="max-w-48">
                <InternalLink
                  href={`/companies/${project.companyId}`}
                  className="block truncate"
                  title={project.companyName}
                >
                  {project.companyName}
                </InternalLink>
              </Cell>
              <Cell>
                <RiskCell flags={project.flags} />
              </Cell>
              <Cell className="max-w-40">
                <LinesOfBusinessCell
                  linesOfBusiness={project.linesOfBusiness}
                />
              </Cell>
              <Cell className="max-w-40">
                <DeliveryCell names={project.deliveryManagerNames} />
              </Cell>
              <Cell className="text-right tabular-nums">
                <RolesCell
                  roleCount={project.roleCount}
                  openRoleCount={project.openRoleCount}
                />
              </Cell>
              <Cell className="tabular-nums">
                {project.startDate && project.endDate ? (
                  formatDateRange(project.startDate, project.endDate)
                ) : (
                  <Absent>No dates</Absent>
                )}
              </Cell>
              <Cell className="text-right">
                <HealthCell
                  health={project.latestHealth}
                  noteDate={project.latestHealthDate}
                />
              </Cell>
              {showMargin ? (
                <Cell className="text-right tabular-nums">
                  <MarginCell project={project} />
                </Cell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * A body cell, top-aligned. The Health and Margin cells stack a figure over its
 * qualifier (the note's date, the margin percentage), so a row is two lines tall in
 * two of its nine columns; top-aligning every cell keeps each row's text starting on
 * one baseline instead of floating the short cells to the middle.
 *
 * A wrapper rather than a class per call site because the vendored `TableCell`
 * hardcodes `align-middle` on the `<td>` itself, which an `align-top` inherited from
 * the `<tr>` would lose to.
 */
function Cell({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <TableCell className={cn("align-top", className)}>{children}</TableCell>
  );
}

/**
 * A column header that sorts. Clicking navigates (`router.replace`) rather than
 * setting local state, because the order is decided by the server query — which is
 * also what makes the sort survive a reload and a shared link.
 */
function SortableHead({
  column,
  label,
  params,
  sort,
  align = "left",
}: {
  column: ProjectSortKey;
  label: string;
  params: SearchParams;
  sort: ProjectsSort;
  align?: "left" | "right";
}) {
  const router = useRouter();

  return (
    <TableHead>
      <div className={cn("flex", align === "right" && "justify-end")}>
        <SortHeaderButton
          sorted={sort.key === column ? sort.dir : false}
          onClick={() =>
            router.replace(
              buildListHref("/projects", PROJECTS_PAGE_KEY, params, {
                sort: column,
                dir: nextSortDirection(column, sort),
              }),
            )
          }
        >
          {label}
        </SortHeaderButton>
      </div>
    </TableHead>
  );
}

/**
 * A value that isn't there, said in words. Never a bare em dash: "No budget" and
 * "Not rated" are actionable statements about the engagement, where a dash reads as
 * a number we lost (ADR 0057 §7).
 */
function Absent({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

/**
 * The derived risk tags. `PROJECT_FLAGS` is ordered worst-first, so `flags[0]` is
 * the one that matters; the rest collapse into a muted `+N` so every row stays the
 * same height and the column reads as a single vertical band. The full list is the
 * cell's `title`.
 *
 * An unflagged project gets an empty cell, not a "None" — this column exists to be
 * scanned for exceptions, and filling it in on every row is exactly what stops a
 * badge from meaning anything.
 */
function RiskCell({ flags }: { flags: ProjectListItem["flags"] }) {
  if (flags.length === 0) return null;

  const [worst, ...rest] = flags;
  const labels = flags.map((flag) => PROJECT_FLAG_LABELS[flag]);

  return (
    <div
      className="flex items-center gap-1 whitespace-nowrap"
      title={labels.join(", ")}
    >
      <Badge variant={PROJECT_FLAG_VARIANTS[worst]}>
        {PROJECT_FLAG_LABELS[worst]}
      </Badge>
      {rest.length > 0 ? (
        <span className="text-muted-foreground text-xs">+{rest.length}</span>
      ) : null}
    </div>
  );
}

/** Comma-joined labels, truncating, with the full set as the cell's `title`. */
function LinesOfBusinessCell({
  linesOfBusiness,
}: {
  linesOfBusiness: ProjectListItem["linesOfBusiness"];
}) {
  if (linesOfBusiness.length === 0) return <Absent>None</Absent>;

  const labels = linesOfBusiness
    .map((lob) => LINE_OF_BUSINESS_LABELS[lob])
    .join(", ");
  return (
    <span className="block truncate" title={labels}>
      {labels}
    </span>
  );
}

/** The delivery managers, truncating, with the full list as the cell's `title`. */
function DeliveryCell({ names }: { names: string[] }) {
  if (names.length === 0) return <Absent>Unassigned</Absent>;

  const joined = names.join(", ");
  return (
    <span className="block truncate" title={joined}>
      {joined}
    </span>
  );
}

/**
 * The staffing shape: how many roles, and how many of them nobody is in yet. The
 * open count is the actionable half, so it only appears when there is one.
 */
function RolesCell({
  roleCount,
  openRoleCount,
}: {
  roleCount: number;
  openRoleCount: number;
}) {
  if (roleCount === 0) return <Absent>None</Absent>;

  return (
    <>
      {roleCount}
      {openRoleCount > 0 ? (
        <span className="ml-1.5 text-muted-foreground">
          {openRoleCount} open
        </span>
      ) : null}
    </>
  );
}

/**
 * The latest delivery note's health as a bar plus its figure, with the note's date
 * beneath. The date is shown because the rating could be months old and a bare
 * "3/10" reads as *now* — the same reason a "Low health" tag deserves to be dated.
 *
 * "Not rated" rather than a dash: nobody has assessed this engagement yet, which is
 * a different statement from an assessment that came back badly (and earns no flag —
 * see `project-flags.ts`). Unlike Margin, Health is shown to every viewer.
 */
function HealthCell({
  health,
  noteDate,
}: {
  health: number | null;
  noteDate: string | null;
}) {
  if (health === null) return <Absent>Not rated</Absent>;

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-1.5">
        <HealthBar value={health} />
        <span className="tabular-nums">{health}</span>
      </div>
      {noteDate ? (
        <span className="text-muted-foreground text-xs">
          {formatShortDate(parseIsoDate(noteDate))}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Plan margin: the money leads and the percentage supports it (ADR 0053 §5), in
 * whichever of the two precomputed currencies the list's toggle is showing.
 *
 * The reasons there is no figure are keyed off **the server's own null**, not
 * re-derived from `roleCount`. Those two disagree: `roleCount` includes cancelled
 * roles, while the figure is null when no role *counts toward the budget*
 * (`countsTowardBudget` excludes cancelled). A budgeted project whose roles were all
 * cancelled therefore passes a `roleCount === 0` guard and falls through to
 * `money(null)` — a bare "—", the one thing this column must never print. Reading
 * the null directly closes that gap and any future cause of it.
 *
 * PERMISSIONS: this renders only inside `showMargin`, and the server only sends
 * figures to a viewer holding `projects.viewMargin` — `project.margin` is `null`
 * otherwise, never a zero. The `null` branch below is the belt to that braces; it
 * must never become a blank cell or a dash, because "there is no column here" and
 * "this project has no margin" are different facts.
 */
function MarginCell({ project }: { project: ProjectListItem }) {
  const { displayCurrency } = useProjectsCurrency();

  if (!project.margin) return null;
  if (project.billingType === null) return <Absent>No budget</Absent>;

  const figure = project.margin[displayCurrency];
  if (figure.margin === null) {
    return (
      <Absent>{project.roleCount === 0 ? "No roles" : "No live roles"}</Absent>
    );
  }

  const { money } = aggregateMoneyFormatters(displayCurrency);

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={marginAmountTone(figure.margin)}>
        {money(figure.margin)}
      </span>
      {figure.marginPercent != null ? (
        <span className="text-muted-foreground text-xs">
          {formatPercent(figure.marginPercent)}
        </span>
      ) : null}
    </div>
  );
}
