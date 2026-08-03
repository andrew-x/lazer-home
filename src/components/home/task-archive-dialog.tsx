"use client";

import { IconArchive } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { MyTaskView } from "@/actions/crm/getMyTasks";
import { TASK_PARENT_KINDS } from "@/actions/crm/tasks.schema";
import { EmptyState } from "@/components/empty-state";
import { ALL, SegmentedFilter } from "@/components/form/filters";
import { SearchFilter } from "@/components/form/search-filter";
import { MyTaskRow } from "@/components/home/my-task-row";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ARCHIVE_LIMIT,
  filterMyTasks,
  sortMyTasksByRecency,
  type TaskStatusFilter,
} from "@/lib/home/my-tasks";
import { asParentKind, PARENT_FILTER_LABELS } from "./task-filter-labels";

const STATUS_OPTIONS = ["open", "completed"] as const;
const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  completed: "Completed",
};

/**
 * The full history behind the todo list: everything assigned to you, open and
 * completed, searchable and filterable.
 *
 * Opens on **Completed** because the trigger is an archive — that's the question
 * being asked ("what did I already do?"). The All and Open segments are there so
 * the dialog can still answer the wider one without a second surface.
 *
 * Rows are the same {@link MyTaskRow} the panel uses, so ticking off works here
 * too; `onDoneChange` is the panel's, so a change made in here is reflected behind
 * the dialog rather than being lost when it closes. `keepIds` is what stops a
 * toggle from immediately contradicting the status filter and unmounting the row
 * the person just clicked — see `MyTaskFilters.keepIds`.
 */
export function TaskArchiveDialog({
  tasks,
  nowMs,
  truncated,
  keepIds,
  onDoneChange,
}: {
  /** The merged, override-corrected list — the panel owns it. */
  tasks: readonly MyTaskView[];
  nowMs: number;
  /** The completed history hit {@link ARCHIVE_LIMIT} and was cut short. */
  truncated: boolean;
  /** Ids toggled this visit, held against the status filter. */
  keepIds: ReadonlySet<string>;
  onDoneChange: (task: MyTaskView, done: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<string>(ALL);
  const [status, setStatus] = useState<TaskStatusFilter>("completed");

  const visible = useMemo(
    () =>
      sortMyTasksByRecency(
        filterMyTasks(tasks, {
          query: search,
          kind: asParentKind(kind),
          status,
          keepIds,
        }),
      ),
    [tasks, search, kind, status, keepIds],
  );

  const filtered = search.trim() !== "" || kind !== ALL || status !== "all";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline">
            <IconArchive />
            Archive
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Your tasks</DialogTitle>
          <DialogDescription>
            Everything assigned to you, open and closed out.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <SearchFilter
            value={search}
            onChange={setSearch}
            placeholder="Search tasks or who they're for…"
          />
          {/* The group's own "All" segment carries the `ALL` sentinel, which isn't
              the `"all"` this filter's type uses — translate at the boundary. */}
          <SegmentedFilter
            label="Status"
            value={status === "all" ? ALL : status}
            options={STATUS_OPTIONS}
            labels={STATUS_LABELS}
            onChange={(next) =>
              setStatus(next === ALL ? "all" : (next as TaskStatusFilter))
            }
          />
          <SegmentedFilter
            label="Relates to"
            value={kind}
            options={TASK_PARENT_KINDS}
            labels={PARENT_FILTER_LABELS}
            onChange={setKind}
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {visible.length === 0 ? (
            <EmptyState>
              {filtered ? "No tasks match your filters." : "No tasks yet."}
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-1">
              {visible.map((task) => (
                <MyTaskRow
                  key={task.id}
                  task={task}
                  done={task.done}
                  nowMs={nowMs}
                  onDoneChange={onDoneChange}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Never imply the archive showed everything when it didn't. */}
        {truncated ? (
          <p className="text-xs text-muted-foreground">
            Showing your {ARCHIVE_LIMIT} most recently completed tasks.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
