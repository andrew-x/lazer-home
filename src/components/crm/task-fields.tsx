"use client";

import type { ReactNode } from "react";
import { useId } from "react";
import { searchStaff } from "@/actions/crm/searchStaff";
import { TASK_MAX_LENGTH } from "@/actions/crm/tasks.schema";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/core/utils";

/**
 * The labelled task fields — a single-line description input beside an owner
 * staff-picker on one row (stacking below `sm`). Shared by every surface that
 * captures a task the same way: the detail-page composer and inline editor
 * (`TaskList`) and the contacts table's in-cell editor. `trailing` holds the
 * row's end control (the composer's Add button); Enter in the description
 * submits, Escape cancels (when `onCancel` is given).
 */
export function TaskFields({
  description,
  onDescriptionChange,
  owner,
  onOwnerChange,
  onSubmit,
  onCancel,
  autoFocus,
  trailing,
  stacked = false,
}: {
  description: string;
  onDescriptionChange: (next: string) => void;
  owner: EntityOption | null;
  onOwnerChange: (next: EntityOption | null) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  trailing?: ReactNode;
  /**
   * Always stack the two fields. A table cell is narrow even on a wide viewport,
   * so the `sm:` breakpoint would read the container wrong there.
   */
  stacked?: boolean;
}) {
  const descriptionId = useId();
  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        !stacked && "sm:flex-row sm:items-end",
      )}
    >
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor={descriptionId}>Next step</Label>
        <Input
          id={descriptionId}
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            } else if (event.key === "Escape" && onCancel) {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder="What's the next step?"
          maxLength={TASK_MAX_LENGTH}
          autoFocus={autoFocus}
        />
      </div>
      <div className={cn("flex flex-col gap-1.5", !stacked && "sm:w-56")}>
        <Label>Owner</Label>
        <EntityCombobox
          value={owner}
          onChange={onOwnerChange}
          searchAction={searchStaff}
          placeholder="Assign to…"
        />
      </div>
      {trailing}
    </div>
  );
}
