"use client";

import { IconChevronRight, IconSearch } from "@tabler/icons-react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import type { StaffRatingEditRow } from "@/actions/performance/getStaffRatingsForEdit";
import { saveStaffEvaluation } from "@/actions/performance/saveStaffEvaluation";
import {
  EditableTable,
  useEditableDraft,
  useEditableRows,
} from "@/components/admin/editable-table";
import { SortHeader } from "@/components/admin/table-filters";
import { ALL, SelectFilter } from "@/components/form/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/core/utils";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import {
  ALL_RUBRIC_KEYS,
  RUBRIC_LABELS,
  rubricForRole,
  SUBRATING_LEVELS,
  type Subratings,
} from "@/lib/performance/rating-rubric";
import { ROLE_LABELS, type Role } from "@/lib/staff/staff-enums";
import {
  decodeLevelValue,
  formatLevel,
  RATING_LEVELS,
  UNRATED_SELECT_VALUE,
} from "@/lib/staff/staff-rating";

/**
 * The editable draft for a staffer: the overall `level` plus one flat string
 * field per subrating category (across all roles), each held as the Select's
 * string value (`"none"` = unrated, else the level as a string). Flattening the
 * subratings into sibling fields — rather than nesting a `Record` — lets the
 * shared `EditableTable` diff each one with `!==` (nested objects would compare
 * by reference), so the changed-set and the confirm dialog work per category for
 * free. The tracked fields are the union across roles; only the visible columns
 * are role-specific.
 */
type EditableValues = { level: string } & Record<string, string>;

const FIELDS: readonly (keyof EditableValues)[] = ["level", ...ALL_RUBRIC_KEYS];
const FIELD_LABELS: Record<keyof EditableValues, string> = {
  level: "Level",
  ...RUBRIC_LABELS,
};

const getStaffId = (row: StaffRatingEditRow) => row.staffId;

/** Flatten a read row into the uniform draft shape: level + every category. */
const pickEditable = (row: StaffRatingEditRow): EditableValues => {
  const values: EditableValues = { level: row.level };
  for (const key of ALL_RUBRIC_KEYS) {
    values[key] = encodeSubrating(row.subratings[key]);
  }
  return values;
};

/** A subrating (1–4 or absent) as the Select's string value. */
function encodeSubrating(level: number | undefined): string {
  return level == null ? UNRATED_SELECT_VALUE : String(level);
}

function levelLabel(value: string): string {
  return value === UNRATED_SELECT_VALUE
    ? "No rating"
    : formatLevel(Number(value));
}

function formatValue(_field: keyof EditableValues, value: string) {
  return levelLabel(value);
}

/** L0–L4 + "No rating", as a Base UI Select bound directly to the row's draft. */
function LevelCell({ staffId }: { staffId: string }) {
  const meta = useEditableDraft<EditableValues>();
  const value = meta.valuesFor(staffId).level;
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) meta.update(staffId, { level: next });
      }}
    >
      <SelectTrigger size="sm" aria-label="Level" className="w-32">
        {/* Label from the draft value we control directly (not Base UI's
            store-derived render arg) — simplest correct source now that the cell
            re-renders on every draft change via useEditableDraft's context. */}
        <SelectValue>{levelLabel(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNRATED_SELECT_VALUE}>No rating</SelectItem>
        {RATING_LEVELS.map((lvl) => (
          <SelectItem key={lvl} value={String(lvl)}>
            {formatLevel(lvl)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * One subrating category cell: "No rating" + L1–L4, bound to the row draft's
 * field for `categoryKey`. Mirrors {@link LevelCell} but on the L1–L4 subrating
 * scale (no L0).
 */
function SubratingCell({
  staffId,
  categoryKey,
}: {
  staffId: string;
  categoryKey: string;
}) {
  const meta = useEditableDraft<EditableValues>();
  const value = meta.valuesFor(staffId)[categoryKey] ?? UNRATED_SELECT_VALUE;
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) meta.update(staffId, { [categoryKey]: next });
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={RUBRIC_LABELS[categoryKey] ?? categoryKey}
        className="w-28"
      >
        <SelectValue>{levelLabel(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNRATED_SELECT_VALUE}>No rating</SelectItem>
        {SUBRATING_LEVELS.map((lvl) => (
          <SelectItem key={lvl} value={String(lvl)}>
            {formatLevel(lvl)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Read-only summary of a staffer's current subratings as compact chips (short
 * label + level), used in the no-filter roster where per-category editing isn't
 * available. Every category in the role's rubric is rendered in the SAME fixed
 * order — unscored ones show a muted "–" in a fixed-width value slot — so chips
 * line up in identical columns across rows and stay comparable. Returns null
 * only when nothing at all is scored.
 */
function SubratingsSummary({
  role,
  subratings,
}: {
  role: Role;
  subratings: Subratings;
}) {
  const rubric = rubricForRole(role);
  if (!rubric.some((category) => subratings[category.key] != null)) return null;
  return (
    <div className="flex max-w-[26rem] flex-wrap gap-1">
      {rubric.map((category) => {
        const level = subratings[category.key];
        return (
          <span
            key={category.key}
            className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs"
          >
            <span className="text-muted-foreground">
              {category.short ?? category.label}
            </span>
            <span
              className={cn(
                "w-6 text-center tabular-nums",
                level == null ? "text-muted-foreground" : "font-medium",
              )}
            >
              {level == null ? "–" : formatLevel(level)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Edit-levels table: one row per active staff member with an overall level
 * dropdown. Selecting a single role in the Role filter expands the grid with that
 * role's subrating rubric as columns (one L1–L4 dropdown per category), so a
 * whole role can be scored and compared side by side. Edits are tracked
 * client-side; a floating bar surfaces the changed count and a confirm dialog
 * shows every changed field before saving. Saving posts one dated `staff_rating`
 * row per changed staff (level + subratings, history preserved). Built on the
 * shared `EditableTable`.
 */
export function EditLevels({ rows }: { rows: StaffRatingEditRow[] }) {
  const router = useRouter();
  const searchId = useId();

  const [sorting, setSorting] = useState<SortingState>([
    { id: "name", desc: false },
  ]);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState(ALL);
  const [lineOfBusiness, setLineOfBusiness] = useState(ALL);

  const editable = useEditableRows<StaffRatingEditRow, EditableValues>({
    rows,
    getRowId: getStaffId,
    getEditableValues: pickEditable,
    fields: FIELDS,
  });

  const save = useAction(saveStaffEvaluation, {
    onSuccess: ({ data }) => {
      if (!data) return;
      toast.success(`Saved ratings for ${data.staffAffected} staff.`);
      editable.reset();
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Failed to save ratings."),
  });

  const roleOptions = useMemo(
    () => [
      ...new Set(rows.map((r) => r.role).filter((r): r is Role => r != null)),
    ],
    [rows],
  );
  const lineOfBusinessOptions = useMemo(
    () => [
      ...new Set(
        rows
          .map((r) => r.lineOfBusiness)
          .filter(
            (lob): lob is NonNullable<StaffRatingEditRow["lineOfBusiness"]> =>
              lob != null,
          ),
      ),
    ],
    [rows],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (query && !row.name.toLowerCase().includes(query)) return false;
      if (role !== ALL && row.role !== role) return false;
      if (lineOfBusiness !== ALL && row.lineOfBusiness !== lineOfBusiness) {
        return false;
      }
      return true;
    });
  }, [rows, search, role, lineOfBusiness]);

  const columns = useMemo<ColumnDef<StaffRatingEditRow>[]>(() => {
    // Subrating columns only make sense for a single role (the rubric differs
    // per role) — show them when the filter narrows to one role with a rubric.
    const activeRubric = role === ALL ? [] : rubricForRole(role as Role);

    const base: ColumnDef<StaffRatingEditRow>[] = [
      {
        accessorKey: "name",
        header: ({ column }) => <SortHeader column={column}>Name</SortHeader>,
        cell: ({ row }) => (
          <Link
            href={`/staff/${row.original.staffId}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "role",
        header: ({ column }) => <SortHeader column={column}>Role</SortHeader>,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.role ? ROLE_LABELS[row.original.role] : "—"}
          </span>
        ),
      },
      {
        accessorKey: "level",
        header: ({ column }) => <SortHeader column={column}>Level</SortHeader>,
        cell: ({ row }) => <LevelCell staffId={row.original.staffId} />,
      },
    ];

    // A role is selected → append its rubric as subrating columns.
    if (activeRubric.length > 0) {
      return [
        ...base,
        ...activeRubric.map<ColumnDef<StaffRatingEditRow>>((category) => ({
          id: category.key,
          header: () => <span className="font-medium">{category.label}</span>,
          cell: ({ row }) => (
            <SubratingCell
              staffId={row.original.staffId}
              categoryKey={category.key}
            />
          ),
        })),
      ];
    }

    // No role selected → show each staffer's current subratings read-only (the
    // rubric differs per role, so per-category editing needs a single-role
    // filter), plus a shortcut that filters to their role to edit. Only for
    // roles with a rubric; others have nothing to score.
    if (role === ALL) {
      return [
        ...base,
        {
          id: "subratings",
          header: () => <span className="font-medium">Subratings</span>,
          cell: ({ row }) => {
            const rowRole = row.original.role;
            if (!rowRole || rubricForRole(rowRole).length === 0) {
              return <span className="text-muted-foreground">—</span>;
            }
            return (
              <div className="flex items-start gap-3">
                <div className="min-w-0">
                  <SubratingsSummary
                    role={rowRole}
                    subratings={row.original.subratings}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground"
                  onClick={() => setRole(rowRole)}
                >
                  Edit
                  <IconChevronRight />
                </Button>
              </div>
            );
          },
        },
      ];
    }

    // A role with no rubric is selected → base columns only.
    return base;
  }, [role]);

  const changes = editable.changedRows.map((r) => {
    const values = editable.valuesFor(r.staffId);
    const subratings: Record<string, number> = {};
    for (const key of ALL_RUBRIC_KEYS) {
      const decoded = decodeLevelValue(values[key] ?? UNRATED_SELECT_VALUE);
      if (decoded != null) subratings[key] = decoded;
    }
    return {
      staffId: r.staffId,
      level: decodeLevelValue(values.level),
      subratings,
    };
  });

  return (
    <div className="flex flex-col gap-6 pb-28">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={searchId}>Name</Label>
          <div className="relative max-w-sm">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={searchId}
              type="search"
              placeholder="Search by name…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <SelectFilter
          label="Line of business"
          value={lineOfBusiness}
          options={lineOfBusinessOptions}
          labels={LINE_OF_BUSINESS_LABELS}
          onChange={setLineOfBusiness}
        />
        <SelectFilter
          label="Role"
          value={role}
          options={roleOptions}
          labels={ROLE_LABELS}
          onChange={setRole}
        />
      </div>

      {/* Hint that subratings unlock when a role with a rubric is selected. */}
      {role === ALL ? (
        <p className="text-sm text-muted-foreground">
          Select a role to score its rubric subratings alongside the overall
          level.
        </p>
      ) : null}

      <EditableTable
        editable={editable}
        rows={filtered}
        columns={columns}
        sorting={sorting}
        onSortingChange={setSorting}
        getRowId={getStaffId}
        getRowLabel={(row) => row.name}
        emptyMessage="No staff match these filters."
        fields={FIELDS}
        fieldLabels={FIELD_LABELS}
        formatValue={formatValue}
        itemNoun="staff"
        dialogDescription={(count) =>
          `Save updated ratings for ${count} staff (recorded as of today).`
        }
        onSave={() => save.execute({ changes })}
        isSaving={save.isExecuting}
      />
    </div>
  );
}
