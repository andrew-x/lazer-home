"use client";

import { IconSearch } from "@tabler/icons-react";
import { useId, useMemo, useState } from "react";
import type { StaffDirectoryEntry } from "@/actions/staff/getStaffDirectory";
import { StaffCard } from "@/components/staff/staff-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { humanizeEnum } from "@/lib/format";

const ALL = "ALL";

/** Small uppercase caption that heads each filter control. */
function FilterLabel({ children }: { children: string }) {
  return (
    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

/** A single-select segmented control with a leading "All" segment. */
function SegmentedFilter({
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
  return (
    <div className="flex flex-col gap-1.5">
      <FilterLabel>{label}</FilterLabel>
      <ToggleGroup
        variant="outline"
        aria-label={label}
        value={[value]}
        // Single-select: ignore the empty array Base UI emits when the active
        // segment is pressed again, so one segment is always selected.
        onValueChange={(values) => {
          if (values.length > 0) onChange(values[0]);
        }}
      >
        <ToggleGroupItem value={ALL}>All</ToggleGroupItem>
        {options.map((option) => (
          <ToggleGroupItem key={option} value={option}>
            {humanizeEnum(option)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/**
 * Staff directory: client-side name search + line-of-business / type segmented
 * controls, a role select, and a "show inactive" switch (off by default, so only
 * active staff show). All filtering is in-memory over the list fetched once on
 * the server.
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
  const searchId = useId();
  const roleId = useId();
  const inactiveId = useId();
  const [search, setSearch] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [showInactive, setShowInactive] = useState(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!showInactive && !entry.isActive) return false;
      if (query && !entry.name.toLowerCase().includes(query)) return false;
      if (lineOfBusiness !== ALL && entry.lineOfBusiness !== lineOfBusiness)
        return false;
      if (role !== ALL && entry.role !== role) return false;
      if (type !== ALL && entry.employmentType !== type) return false;
      return true;
    });
  }, [entries, search, lineOfBusiness, role, type, showInactive]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={searchId}>Name</Label>
          <div className="relative">
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

        <SegmentedFilter
          label="Line of business"
          value={lineOfBusiness}
          options={lineOfBusinessOptions}
          onChange={setLineOfBusiness}
        />

        <div className="flex flex-wrap items-end gap-6">
          <SegmentedFilter
            label="Type"
            value={type}
            options={typeOptions}
            onChange={setType}
          />

          <div className="flex flex-col gap-1.5">
            <FilterLabel>Role</FilterLabel>
            <Select
              value={role}
              onValueChange={(value) => setRole(value ?? ALL)}
            >
              <SelectTrigger id={roleId} aria-label="Role" className="w-44">
                <SelectValue>
                  {(value: string) =>
                    value === ALL ? "All" : humanizeEnum(value)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {roleOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {humanizeEnum(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex h-9 items-center gap-2 text-sm">
            <Switch
              id={inactiveId}
              checked={showInactive}
              onCheckedChange={setShowInactive}
            />
            <label htmlFor={inactiveId}>Show inactive</label>
          </div>
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
