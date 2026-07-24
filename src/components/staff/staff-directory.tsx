"use client";

import { IconSearch } from "@tabler/icons-react";
import { useId, useMemo, useState } from "react";
import type { StaffDirectoryEntry } from "@/actions/staff/getStaffDirectory";
import {
  ALL,
  FilterLabel,
  SegmentedFilter,
  SelectFilter,
} from "@/components/form/filters";
import { SkillsFilter } from "@/components/form/skills-filter";
import { StaffCard } from "@/components/staff/staff-card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { matchesSkillFilter, type ProficiencyLevel } from "@/lib/staff/skills";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff/staff-enums";

/** Sentinel min-level meaning "any proficiency" — imposes no level constraint. */
const ANY_LEVEL = "ANY";
type MinLevel = ProficiencyLevel | typeof ANY_LEVEL;

/** Minimum-level segments, ascending (raises the bar left → right). */
const MIN_LEVEL_OPTIONS: { value: ProficiencyLevel; label: string }[] = [
  { value: "intermediate", label: "Intermediate+" },
  { value: "senior", label: "Senior" },
];

/**
 * Staff directory: client-side name search + line-of-business / role selects, a
 * type button group, a skills multi-select (with an optional minimum-proficiency
 * filter), and a "show inactive" switch (off by default, so only active staff
 * show). All filtering is in-memory over the list fetched once on the server.
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
  const inactiveId = useId();
  const [search, setSearch] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [skills, setSkills] = useState<string[]>([]);
  const [minLevel, setMinLevel] = useState<MinLevel>(ANY_LEVEL);
  const [showInactive, setShowInactive] = useState(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const minimum = minLevel === ANY_LEVEL ? undefined : minLevel;
    return entries.filter((entry) => {
      if (!showInactive && !entry.isActive) return false;
      if (query && !entry.name.toLowerCase().includes(query)) return false;
      if (lineOfBusiness !== ALL && entry.lineOfBusiness !== lineOfBusiness)
        return false;
      if (role !== ALL && entry.role !== role) return false;
      if (type !== ALL && entry.employmentType !== type) return false;
      if (!matchesSkillFilter(entry.skills, skills, minimum)) return false;
      return true;
    });
  }, [
    entries,
    search,
    lineOfBusiness,
    role,
    type,
    skills,
    minLevel,
    showInactive,
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
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
              className="pl-9"
            />
          </div>
        </div>

        <div className="grid grid-cols-4 items-end gap-4">
          <div className="col-span-3">
            <SkillsFilter value={skills} onChange={setSkills} />
          </div>
          {skills.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <FilterLabel>Minimum level</FilterLabel>
              <ToggleGroup
                variant="outline"
                spacing={0}
                aria-label="Minimum level"
                value={[minLevel]}
                // Single-select: keep one segment always active (see SegmentedFilter).
                onValueChange={(values) => {
                  if (values.length > 0) setMinLevel(values[0] as MinLevel);
                }}
              >
                <ToggleGroupItem value={ANY_LEVEL}>Any</ToggleGroupItem>
                {MIN_LEVEL_OPTIONS.map((option) => (
                  <ToggleGroupItem key={option.value} value={option.value}>
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-4 items-end gap-4">
          <SelectFilter
            label="Line of business"
            value={lineOfBusiness}
            options={lineOfBusinessOptions}
            labels={LINE_OF_BUSINESS_LABELS}
            onChange={setLineOfBusiness}
            triggerClassName="w-full"
          />
          <SelectFilter
            label="Role"
            value={role}
            options={roleOptions}
            labels={ROLE_LABELS}
            onChange={setRole}
            triggerClassName="w-full"
          />
          <SegmentedFilter
            label="Type"
            value={type}
            options={typeOptions}
            labels={EMPLOYMENT_TYPE_LABELS}
            onChange={setType}
          />
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
            <StaffCard
              key={entry.id}
              entry={entry}
              highlightedSkills={skills}
            />
          ))}
        </div>
      )}
    </div>
  );
}
