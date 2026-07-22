"use client";

import { IconSearch } from "@tabler/icons-react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { commitUserChanges } from "@/actions/admin/commitUserChanges";
import type { UserAdminRow } from "@/actions/admin/getUsers";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { type AppRole, ROLE_SLUGS } from "@/lib/auth/permissions";
import { humanizeEnum } from "@/lib/format/format";
import {
  EditableTable,
  useEditableDraft,
  useEditableRows,
} from "./editable-table";
import {
  ALL,
  FilterLabel,
  SelectFilter,
  SortHeader,
  TriStateFilter,
} from "./table-filters";

/** The two editable RBAC fields, tracked client-side per user. */
type EditableValues = {
  role: AppRole | null;
  banned: boolean;
};

const USER_FIELDS = [
  "role",
  "banned",
] as const satisfies readonly (keyof EditableValues)[];

const FIELD_LABELS: Record<keyof EditableValues, string> = {
  role: "Role",
  banned: "Banned",
};

const getUserId = (row: UserAdminRow) => row.id;

function pickEditable(row: UserAdminRow): EditableValues {
  return { role: row.role, banned: row.banned };
}

function formatValue(
  field: keyof EditableValues,
  value: EditableValues[keyof EditableValues],
): string {
  if (field === "banned") return value ? "Yes" : "No";
  return value ? humanizeEnum(value as string) : "—";
}

// --- Cell editors ----------------------------------------------------------

function RoleCell({ userId }: { userId: string }) {
  const meta = useEditableDraft<EditableValues>();
  const value = meta.valuesFor(userId).role;
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) meta.update(userId, { role: next as AppRole });
      }}
    >
      <SelectTrigger size="sm" aria-label="Role" className="w-44">
        {/* Label from the draft value we control, not Base UI's store-derived
            render arg (see edit-levels / editable-table for why). */}
        <SelectValue>{value ? humanizeEnum(value) : "Set role"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ROLE_SLUGS.map((option) => (
          <SelectItem key={option} value={option}>
            {humanizeEnum(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BannedCell({ userId }: { userId: string }) {
  const meta = useEditableDraft<EditableValues>();
  const checked = meta.valuesFor(userId).banned;
  return (
    <Switch
      checked={checked}
      onCheckedChange={(next) => meta.update(userId, { banned: next })}
      aria-label="Banned"
    />
  );
}

// --- Main component --------------------------------------------------------

/**
 * Admin table for managing application users' RBAC role and ban status. Edits
 * are tracked client-side per user; a floating bar surfaces the changed count
 * and a confirmation dialog summarises every field diff before committing.
 * Search/filtering/sorting are in-memory over the users fetched once on the
 * server. Mutations go through the Better Auth admin API via `commitUserChanges`.
 */
export function ManageUsers({ users }: { users: UserAdminRow[] }) {
  const router = useRouter();

  const [sorting, setSorting] = useState<SortingState>([
    { id: "name", desc: false },
  ]);

  // Filters
  const [search, setSearch] = useState("");
  const [role, setRole] = useState(ALL);
  const [banned, setBanned] = useState(ALL);

  const editable = useEditableRows<UserAdminRow, EditableValues>({
    rows: users,
    getRowId: getUserId,
    getEditableValues: pickEditable,
    fields: USER_FIELDS,
  });

  const commit = useAction(commitUserChanges, {
    onSuccess: ({ data }) => {
      if (!data) return;
      toast.success(`Updated ${data.usersAffected} users.`);
      editable.reset();
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Failed to save changes."),
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((row) => {
      if (
        query &&
        !row.name.toLowerCase().includes(query) &&
        !row.email.toLowerCase().includes(query)
      )
        return false;
      if (role !== ALL && row.role !== role) return false;
      if (banned !== ALL && String(row.banned) !== banned) return false;
      return true;
    });
  }, [users, search, role, banned]);

  const columns = useMemo<ColumnDef<UserAdminRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortHeader column={column}>Name</SortHeader>,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.email}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: ({ column }) => <SortHeader column={column}>Role</SortHeader>,
        cell: ({ row }) => <RoleCell userId={row.original.id} />,
      },
      {
        accessorKey: "banned",
        header: ({ column }) => <SortHeader column={column}>Banned</SortHeader>,
        cell: ({ row }) => <BannedCell userId={row.original.id} />,
      },
    ],
    [],
  );

  const changes = editable.changedRows.map((r) => ({
    userId: r.id,
    ...editable.valuesFor(r.id),
  }));

  return (
    <div className="flex flex-col gap-6 pb-28">
      {/* Filters — all on one line */}
      <div className="flex flex-wrap items-end gap-6">
        <div className="flex flex-col gap-1.5">
          <FilterLabel>Search</FilterLabel>
          <div className="relative w-64">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search"
              placeholder="Search by name or email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <SelectFilter
          label="Role"
          value={role}
          options={ROLE_SLUGS}
          onChange={setRole}
        />
        <TriStateFilter label="Banned" value={banned} onChange={setBanned} />
      </div>

      <EditableTable
        editable={editable}
        rows={filtered}
        columns={columns}
        sorting={sorting}
        onSortingChange={setSorting}
        getRowId={getUserId}
        getRowLabel={(row) => row.name}
        emptyMessage="No users match these filters."
        fields={USER_FIELDS}
        fieldLabels={FIELD_LABELS}
        formatValue={formatValue}
        itemNoun="users"
        dialogDescription={(count) =>
          `Update role and ban status for ${count} users.`
        }
        onSave={() => commit.execute({ changes })}
        isSaving={commit.isExecuting}
      />
    </div>
  );
}
