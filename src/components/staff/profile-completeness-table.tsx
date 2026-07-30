"use client";

import { IconSearch } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import type { ProfileCompletenessRow } from "@/actions/staff/getProfileCompleteness";
import { SortHeader } from "@/components/admin/table-filters";
import { DataTable } from "@/components/data-table";
import { EmptyCell } from "@/components/empty-cell";
import { ALL, FilterLabel, SelectFilter } from "@/components/form/filters";
import { ROOMY_TABLE } from "@/components/table-density";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/core/utils";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { formatShortDate } from "@/lib/format/format";
import {
  type CompletenessBreakdownItem,
  linksBreakdown,
  manualOfMeBreakdown,
  PROFILE_COMPLETENESS_TOTALS,
  waysOfWorkingBreakdown,
} from "@/lib/staff/profile-completeness";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff/staff-enums";
import { STAFF_FILTER_OPTIONS } from "@/lib/staff/staff-filters";

/**
 * A "done / not done" cell. The repo has no tick-vs-dash convention, so it is
 * defined once here and shared by both boolean columns rather than inlined per
 * column. The dash is the shared `EmptyCell`, so "nothing here" looks the same
 * as it does in every other table.
 */
function DoneCell({ done }: { done: boolean }) {
  if (!done) return <EmptyCell />;
  return (
    <>
      <span aria-hidden>✓</span>
      <span className="sr-only">Yes</span>
    </>
  );
}

/** How many of the three profile links are set. Derived from the same three
 * booleans the tooltip lists, so the cell and its breakdown can never disagree
 * — which is why the read no longer ships a separate pre-summed count. */
function linkCountOf(row: ProfileCompletenessRow): number {
  return linksBreakdown(row).filter((item) => item.done > 0).length;
}

/**
 * One line of a breakdown tooltip: a tick or dash for an all-or-nothing piece,
 * a fraction for a group of them.
 *
 * **Finished rows are the ones dimmed**, not the outstanding ones. Someone opens
 * this tooltip to find what is still missing, so the gaps have to be what the eye
 * lands on — dimming them would bury the answer.
 */
function BreakdownRow({ item }: { item: CompletenessBreakdownItem }) {
  const complete = item.done === item.total;
  return (
    <li
      className={cn(
        "flex w-full items-baseline justify-between gap-4",
        complete && "text-background/50",
      )}
    >
      <span>{item.label}</span>
      <span className="shrink-0 tabular-nums">
        {item.total === 1 ? (
          <span aria-hidden>{complete ? "✓" : "—"}</span>
        ) : (
          `${item.done}/${item.total}`
        )}
        <span className="sr-only">
          {item.total === 1
            ? complete
              ? "done"
              : "not done"
            : `${item.done} of ${item.total}`}
        </span>
      </span>
    </li>
  );
}

/**
 * A count against a fixed total ("14 of 30"). Zero renders as the empty dash
 * rather than "0 of 30" — the whole point of the table is that unstarted should
 * be visually distinct from partially done at a glance.
 *
 * **Partly-done values carry a hover/focus tooltip naming what's left**, which is
 * the difference between "chase this person" and knowing what to chase them for.
 * It is deliberately *only* on partial values: at zero and at full there is
 * nothing a breakdown would add that the cell doesn't already say, and a tooltip
 * on every cell would make the table noisy to move a mouse across.
 */
function CountCell({
  count,
  total,
  breakdown,
}: {
  count: number;
  total: number;
  /** Built lazily — the tooltip is the only consumer, so a fully-done or
   * untouched row never pays for it. */
  breakdown: () => CompletenessBreakdownItem[];
}) {
  if (count === 0) return <EmptyCell />;

  const value = (
    <span className="tabular-nums">
      {count} <span className="text-muted-foreground">of {total}</span>
    </span>
  );
  if (count === total) return value;

  return (
    <Tooltip>
      {/* A button, not a bare span: the tooltip has to be reachable by keyboard,
          and this is the only way to read what's outstanding. */}
      <TooltipTrigger
        render={
          <button
            type="button"
            className="cursor-help underline decoration-dotted decoration-muted-foreground underline-offset-4"
          >
            {value}
          </button>
        }
      />
      <TooltipContent className="max-w-none flex-col items-stretch gap-1 p-3">
        <ul className="flex w-56 flex-col gap-1">
          {breakdown().map((item) => (
            <BreakdownRow key={item.label} item={item} />
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

function DateCell({ value }: { value: Date | null }) {
  if (!value) return <EmptyCell />;
  return <span className="tabular-nums">{formatShortDate(value)}</span>;
}

/**
 * Sort key for a nullable "last updated" date. Never-updated sorts as the
 * OLDEST (0), so ascending puts it first — the same "least done first" order the
 * count and boolean columns already give, which is the one thing this table is
 * for. Every real timestamp is post-epoch, so 0 can't collide with one.
 *
 * This is a deliberate departure from `compareSortValues`' nulls-last rule, and
 * the difference is semantic, not stylistic: there, a comp row with no proposal
 * is *absent* and burying it in both directions is right. Here a null means
 * "never touched this field" — genuinely the far end of the staleness scale, and
 * exactly who a manager is looking for. (Do NOT reach for TanStack's
 * `sortUndefined`: it returns before the descending inversion is applied, so
 * `"first"`/`"last"` pin undefined to the same end in BOTH directions —
 * which would make ascending on these two columns hide the very people the page
 * promises to surface.)
 *
 * The enum columns below keep `sortUndefined: "last"`, because there a null
 * really is absent — the person has no employment row at all.
 */
function dateSortValue(value: Date | null) {
  return value ? value.getTime() : 0;
}

/**
 * Who has and hasn't filled out their staff profile — links, résumé, skills,
 * client intro and the two profile surveys — across the whole company.
 *
 * Filtering and sorting are both in-memory over one server read, matching every
 * other staff table (the directory, bulk-edit, edit-levels). Nothing is in the
 * URL. Every completeness column sorts ascending on first click, and ascending
 * is deliberately the "who still needs chasing" order across all of them: zero
 * links, no résumé, no skills, never-updated. Keep that invariant if you add a
 * column — it is the whole reason the table exists (see `dateSortValue` for the
 * one place it took real care to preserve).
 */
export function ProfileCompletenessTable({
  rows,
}: {
  rows: ProfileCompletenessRow[];
}) {
  const searchId = useId();
  const inactiveId = useId();

  const [search, setSearch] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [showInactive, setShowInactive] = useState(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!showInactive && !row.isActive) return false;
      if (query && !row.name.toLowerCase().includes(query)) return false;
      if (lineOfBusiness !== ALL && row.lineOfBusiness !== lineOfBusiness)
        return false;
      if (role !== ALL && row.role !== role) return false;
      if (type !== ALL && row.employmentType !== type) return false;
      return true;
    });
  }, [rows, search, lineOfBusiness, role, type, showInactive]);

  const columns = useMemo<ColumnDef<ProfileCompletenessRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortHeader column={column}>Person</SortHeader>,
        cell: ({ row }) => (
          <Link
            href={`/staff/${row.original.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "lineOfBusiness",
        accessorFn: (row) =>
          row.lineOfBusiness
            ? LINE_OF_BUSINESS_LABELS[row.lineOfBusiness]
            : undefined,
        sortUndefined: "last",
        header: ({ column }) => (
          <SortHeader column={column}>Line of business</SortHeader>
        ),
        cell: ({ row }) =>
          row.original.lineOfBusiness ? (
            LINE_OF_BUSINESS_LABELS[row.original.lineOfBusiness]
          ) : (
            <EmptyCell />
          ),
      },
      {
        id: "role",
        accessorFn: (row) => (row.role ? ROLE_LABELS[row.role] : undefined),
        sortUndefined: "last",
        header: ({ column }) => <SortHeader column={column}>Role</SortHeader>,
        cell: ({ row }) =>
          row.original.role ? ROLE_LABELS[row.original.role] : <EmptyCell />,
      },
      {
        id: "employmentType",
        accessorFn: (row) =>
          row.employmentType
            ? EMPLOYMENT_TYPE_LABELS[row.employmentType]
            : undefined,
        sortUndefined: "last",
        header: ({ column }) => <SortHeader column={column}>Type</SortHeader>,
        cell: ({ row }) =>
          row.original.employmentType ? (
            EMPLOYMENT_TYPE_LABELS[row.original.employmentType]
          ) : (
            <EmptyCell />
          ),
      },
      {
        id: "links",
        accessorFn: (row) => linkCountOf(row),
        header: ({ column }) => <SortHeader column={column}>Links</SortHeader>,
        cell: ({ row }) => (
          <CountCell
            count={linkCountOf(row.original)}
            total={PROFILE_COMPLETENESS_TOTALS.links}
            breakdown={() => linksBreakdown(row.original)}
          />
        ),
      },
      {
        accessorKey: "hasResume",
        header: ({ column }) => <SortHeader column={column}>Résumé</SortHeader>,
        cell: ({ row }) => <DoneCell done={row.original.hasResume} />,
      },
      {
        accessorKey: "skillCount",
        header: ({ column }) => <SortHeader column={column}>Skills</SortHeader>,
        cell: ({ row }) =>
          row.original.skillCount === 0 ? (
            <EmptyCell />
          ) : (
            <span className="tabular-nums">{row.original.skillCount}</span>
          ),
      },
      {
        id: "skillsUpdatedAt",
        accessorFn: (row) => dateSortValue(row.skillsUpdatedAt),
        header: ({ column }) => (
          <SortHeader column={column}>Skills updated</SortHeader>
        ),
        cell: ({ row }) => <DateCell value={row.original.skillsUpdatedAt} />,
      },
      {
        accessorKey: "hasClientIntro",
        header: ({ column }) => (
          <SortHeader column={column}>Client intro</SortHeader>
        ),
        cell: ({ row }) => <DoneCell done={row.original.hasClientIntro} />,
      },
      {
        id: "clientIntroUpdatedAt",
        accessorFn: (row) => dateSortValue(row.clientIntroUpdatedAt),
        header: ({ column }) => (
          <SortHeader column={column}>Intro updated</SortHeader>
        ),
        cell: ({ row }) => (
          <DateCell value={row.original.clientIntroUpdatedAt} />
        ),
      },
      {
        id: "manualOfMe",
        accessorFn: (row) => row.manualOfMeAnsweredIds.length,
        header: ({ column }) => (
          <SortHeader column={column}>Manual of Me</SortHeader>
        ),
        cell: ({ row }) => (
          <CountCell
            count={row.original.manualOfMeAnsweredIds.length}
            total={PROFILE_COMPLETENESS_TOTALS.manualOfMe}
            breakdown={() =>
              manualOfMeBreakdown(new Set(row.original.manualOfMeAnsweredIds))
            }
          />
        ),
      },
      {
        id: "waysOfWorking",
        accessorFn: (row) => row.waysOfWorkingAnsweredIds.length,
        header: ({ column }) => (
          <SortHeader column={column}>Ways of working</SortHeader>
        ),
        cell: ({ row }) => (
          <CountCell
            count={row.original.waysOfWorkingAnsweredIds.length}
            total={PROFILE_COMPLETENESS_TOTALS.waysOfWorking}
            breakdown={() =>
              waysOfWorkingBreakdown(
                new Set(row.original.waysOfWorkingAnsweredIds),
              )
            }
          />
        ),
      },
    ],
    [],
  );

  // `showInactive` is deliberately excluded: hiding departed staff is the
  // baseline view, not a narrowing the user asked for, so it must not light up
  // "Clear filters" (the same call the org chart makes about what counts as a
  // filter being active).
  const hasFilters =
    search.trim() !== "" ||
    lineOfBusiness !== ALL ||
    role !== ALL ||
    type !== ALL;

  const clearFilters = () => {
    setSearch("");
    setLineOfBusiness(ALL);
    setRole(ALL);
    setType(ALL);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* One full-width grid so every control shares a column width and the
          labels sit on a single baseline. Each control is stretched to its cell
          (`w-full`) rather than carrying its own fixed width, which is what lets
          the row scale with the viewport instead of leaving a ragged tail. */}
      <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1.5">
          <FilterLabel htmlFor={searchId}>Name</FilterLabel>
          <div className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={searchId}
              type="search"
              placeholder="Search by name…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full pl-9"
            />
          </div>
        </div>
        <SelectFilter
          label="Line of business"
          value={lineOfBusiness}
          options={STAFF_FILTER_OPTIONS.lineOfBusiness}
          labels={LINE_OF_BUSINESS_LABELS}
          onChange={setLineOfBusiness}
          triggerClassName="w-full"
        />
        <SelectFilter
          label="Role"
          value={role}
          options={STAFF_FILTER_OPTIONS.role}
          labels={ROLE_LABELS}
          onChange={setRole}
          triggerClassName="w-full"
        />
        <SelectFilter
          label="Type"
          value={type}
          options={STAFF_FILTER_OPTIONS.employmentType}
          labels={EMPLOYMENT_TYPE_LABELS}
          onChange={setType}
          triggerClassName="w-full"
        />
        {/* Shares the last cell: the toggle reads left-to-right with the other
            controls, and Clear sits at the row's end where the eye lands after
            setting a filter. Only rendered when something is actually filtered,
            so the row doesn't carry a permanently dead affordance. */}
        <div className="flex h-9 items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Switch
              id={inactiveId}
              checked={showInactive}
              onCheckedChange={setShowInactive}
            />
            <label htmlFor={inactiveId}>Show inactive</label>
          </div>
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        defaultSorting={[{ id: "name", desc: false }]}
        className={ROOMY_TABLE}
        emptyMessage="No staff match these filters."
      />
    </div>
  );
}
