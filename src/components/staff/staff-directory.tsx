"use client";

import { IconSearch } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { StaffDirectoryEntry } from "@/actions/staff/getStaffDirectory";
import { StaffCard } from "@/components/staff/staff-card";
import { Input } from "@/components/ui/input";
import { humanizeEnum } from "@/lib/format";
import { cn } from "@/lib/utils";

const ALL = "ALL";

/** A labelled native select styled to match the input primitive. */
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const id = `filter-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-9 rounded border bg-transparent px-3 text-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <option value={ALL}>All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {humanizeEnum(option)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Staff directory: client-side name search + line-of-business / role / type
 * filters + an "active only" toggle (default on). All filtering is in-memory over
 * the full list fetched once on the server.
 */
export function StaffDirectory({
  entries,
  lineOfBusinessOptions,
  roleOptions,
  typeOptions,
}: {
  entries: StaffDirectoryEntry[];
  lineOfBusinessOptions: string[];
  roleOptions: string[];
  typeOptions: string[];
}) {
  const [search, setSearch] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [activeOnly, setActiveOnly] = useState(true);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (activeOnly && !entry.isActive) return false;
      if (query && !entry.name.toLowerCase().includes(query)) return false;
      if (lineOfBusiness !== ALL && entry.lineOfBusiness !== lineOfBusiness)
        return false;
      if (role !== ALL && entry.role !== role) return false;
      if (type !== ALL && entry.employmentType !== type) return false;
      return true;
    });
  }, [entries, search, lineOfBusiness, role, type, activeOnly]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by name…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <FilterSelect
            label="Line of business"
            value={lineOfBusiness}
            options={lineOfBusinessOptions}
            onChange={setLineOfBusiness}
          />
          <FilterSelect
            label="Role"
            value={role}
            options={roleOptions}
            onChange={setRole}
          />
          <FilterSelect
            label="Type"
            value={type}
            options={typeOptions}
            onChange={setType}
          />
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(event) => setActiveOnly(event.target.checked)}
              className="size-4"
            />
            Active only
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No staff match these filters.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((entry) => (
            <StaffCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
