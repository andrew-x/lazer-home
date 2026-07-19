"use client";

import { IconSearch } from "@tabler/icons-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/line-of-business";
import { ROLE_LABELS, type Role } from "@/lib/staff-enums";
import {
  decodeLevelValue,
  formatLevel,
  RATING_LEVELS,
  UNRATED_SELECT_VALUE,
} from "@/lib/staff-rating";

/**
 * The one editable fact: the staff member's level, held as the Select's string
 * value (`"none"` = unrated, else `"0".."4"`). Keyed `level` to match the read
 * row — the shared `EditableTable` types its draft handles against the row — so
 * the cell reads/writes a plain string with no conversion, like the other
 * bulk-edit dropdowns.
 */
type EditableValues = Pick<StaffRatingEditRow, "level">;

const FIELD_LABELS: Record<keyof EditableValues, string> = { level: "Level" };
const FIELDS = ["level"] as const satisfies readonly (keyof EditableValues)[];

const getStaffId = (row: StaffRatingEditRow) => row.staffId;
const pickEditable = (row: StaffRatingEditRow): EditableValues => ({
  level: row.level,
});

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
 * Edit-levels table: one row per active staff member with a level dropdown. Edits
 * are tracked client-side; a floating bar surfaces the changed count and a
 * confirm dialog shows every old→new level before saving. Saving posts one dated
 * `staff_rating` row per changed staff (history preserved). Mirrors the admin
 * bulk-edit-roles UX on the shared `EditableTable`.
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
      toast.success(`Saved levels for ${data.staffAffected} staff.`);
      editable.reset();
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Failed to save levels."),
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

  const columns = useMemo<ColumnDef<StaffRatingEditRow>[]>(
    () => [
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
    ],
    [],
  );

  const changes = editable.changedRows.map((r) => ({
    staffId: r.staffId,
    level: decodeLevelValue(editable.valuesFor(r.staffId).level),
  }));

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
          `Save an updated level for ${count} staff (recorded as of today).`
        }
        onSave={() => save.execute({ changes })}
        isSaving={save.isExecuting}
      />
    </div>
  );
}
