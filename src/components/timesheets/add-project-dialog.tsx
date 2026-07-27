"use client";

import { IconPlus, IconSearch } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { SelectableProject } from "@/actions/timesheets/getSelectableProjects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  TIMESHEET_CATEGORY,
  TIMESHEET_CATEGORY_LABELS,
} from "@/lib/timesheets/timesheet-category";
import {
  CATEGORY_PREFIX,
  PROJECT_PREFIX,
  targetKey,
} from "@/lib/timesheets/timesheet-grid";

type Props = {
  /** All projects available as timesheet targets. */
  projects: SelectableProject[];
  /** Ids of projects this person is allocated to this week (shown first). */
  allocatedProjectIds: string[];
  /** Target keys already on the grid, filtered out of the picker. */
  usedKeys: Set<string>;
  /** Add a target — receives a `PROJECT_PREFIX`/`CATEGORY_PREFIX` value. */
  onSelect: (value: string) => void;
};

/** One selectable row in the picker list. */
function PickerItem({
  onSelect,
  label,
  sublabel,
}: {
  onSelect: () => void;
  label: string;
  sublabel?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left hover:bg-muted"
    >
      <span className="font-medium">{label}</span>
      {sublabel ? (
        <span className="text-xs text-muted-foreground">{sublabel}</span>
      ) : null}
    </button>
  );
}

function matches(query: string, ...fields: (string | null | undefined)[]) {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(q));
}

/**
 * Searchable "Add project" dialog for the timesheet grid. Projects the person is
 * allocated to that week surface first as suggestions; every project stays
 * searchable (logging against any project is allowed), and the non-billable
 * categories share the dialog so it's the single entry point for adding a row.
 */
export function AddProjectDialog({
  projects,
  allocatedProjectIds,
  usedKeys,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const allocatedSet = useMemo(
    () => new Set(allocatedProjectIds),
    [allocatedProjectIds],
  );

  // Available (not-yet-added) targets, split into the three sections.
  const { suggested, others, categories } = useMemo(() => {
    const available = projects.filter(
      (p) => !usedKeys.has(targetKey(p.id, null)),
    );
    return {
      suggested: available.filter((p) => allocatedSet.has(p.id)),
      others: available.filter((p) => !allocatedSet.has(p.id)),
      categories: TIMESHEET_CATEGORY.filter(
        (c) => !usedKeys.has(targetKey(null, c)),
      ),
    };
  }, [projects, usedKeys, allocatedSet]);

  const filteredSuggested = suggested.filter((p) =>
    matches(query, p.name, p.companyName),
  );
  const filteredOthers = others.filter((p) =>
    matches(query, p.name, p.companyName),
  );
  const filteredCategories = categories.filter((c) =>
    matches(query, TIMESHEET_CATEGORY_LABELS[c]),
  );
  const hasResults =
    filteredSuggested.length > 0 ||
    filteredOthers.length > 0 ||
    filteredCategories.length > 0;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  function choose(value: string) {
    onSelect(value);
    handleOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <IconPlus />
            Add project
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a project or category</DialogTitle>
          <DialogDescription>
            Search all projects, or pick one you're allocated to this week.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <IconSearch className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
          {filteredSuggested.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              <p className="px-2 text-xs font-medium text-muted-foreground">
                Allocated to you
              </p>
              {filteredSuggested.map((p) => (
                <PickerItem
                  key={p.id}
                  label={p.name}
                  sublabel={p.companyName}
                  onSelect={() => choose(`${PROJECT_PREFIX}${p.id}`)}
                />
              ))}
            </div>
          ) : null}

          {filteredOthers.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              <p className="px-2 text-xs font-medium text-muted-foreground">
                All projects
              </p>
              {filteredOthers.map((p) => (
                <PickerItem
                  key={p.id}
                  label={p.name}
                  sublabel={p.companyName}
                  onSelect={() => choose(`${PROJECT_PREFIX}${p.id}`)}
                />
              ))}
            </div>
          ) : null}

          {filteredCategories.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              <p className="px-2 text-xs font-medium text-muted-foreground">
                Non-billable
              </p>
              {filteredCategories.map((c) => (
                <PickerItem
                  key={c}
                  label={TIMESHEET_CATEGORY_LABELS[c]}
                  onSelect={() => choose(`${CATEGORY_PREFIX}${c}`)}
                />
              ))}
            </div>
          ) : null}

          {hasResults ? null : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No matches.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
