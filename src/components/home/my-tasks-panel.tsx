"use client";

import { useMemo, useState } from "react";
import type { MyTasksView, MyTaskView } from "@/actions/crm/getMyTasks";
import { TASK_PARENT_KINDS } from "@/actions/crm/tasks.schema";
import { EmptyState } from "@/components/empty-state";
import { ALL, SegmentedFilter } from "@/components/form/filters";
import { SearchFilter } from "@/components/form/search-filter";
import { MyTaskRow } from "@/components/home/my-task-row";
import { TaskArchiveDialog } from "@/components/home/task-archive-dialog";
import {
  applyDoneOverrides,
  filterMyTasks,
  mergeMyTasks,
} from "@/lib/home/my-tasks";
import { asParentKind, PARENT_FILTER_LABELS } from "./task-filter-labels";

/**
 * The home dashboard's personal todo list: every task assigned to you, newest
 * first, with a search box and a parent-kind filter, plus a dialog for the full
 * history including everything you've already closed out.
 *
 * **Ticking a task off does not remove it.** The row stays put, struck through,
 * with the checkbox still live — so a mis-click is one click to undo rather than a
 * hunt through the archive. That's what `overrides` buys: a map of the done-states
 * changed during this visit, which survives the `router.refresh()` each toggle
 * fires and keeps a just-completed task rendered where it was. It's session-scoped
 * on purpose; a reload is the point at which a finished task should drop out.
 *
 * Filtering is **in-memory, not URL-backed**. The whole list is already on the
 * client, and the home route deliberately keeps no URL state — the Lazer Status
 * band's filters are local for the same reason. (So: `SearchFilter`, the
 * presentational control — not `useUrlSearchFilter`, which navigates.)
 */
export function MyTasksPanel({
  tasks,
  nowMs,
}: {
  tasks: MyTasksView;
  /** Server-supplied "now", so staleness is identical across hydration. */
  nowMs: number;
}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<string>(ALL);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );

  const onDoneChange = (task: MyTaskView, done: boolean) =>
    setOverrides((current) => new Map(current).set(task.id, done));

  // One merged, override-corrected list feeds both this panel and the archive, so
  // a task ticked in either surface reads the same way in the other.
  const all = useMemo(
    () =>
      applyDoneOverrides(mergeMyTasks(tasks.open, tasks.completed), overrides),
    [tasks.open, tasks.completed, overrides],
  );

  // Everything toggled this visit is held in place against the status filter, in
  // both this panel and the archive — that's the accidental-click undo. Derived
  // once here so the two surfaces can't drift apart on the rule.
  const keepIds = useMemo(() => new Set(overrides.keys()), [overrides]);

  const visible = useMemo(
    () =>
      filterMyTasks(all, {
        query: search,
        kind: asParentKind(kind),
        status: "open",
        keepIds,
      }),
    [all, search, kind, keepIds],
  );

  const openCount = all.filter((task) => !task.done).length;
  const filtered = search.trim() !== "" || kind !== ALL;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="font-heading text-base font-semibold tracking-tight">
          Tasks
        </h3>
        <p className="text-sm text-muted-foreground">
          Assigned to you — open right now.{" "}
          {openCount > 0 ? `${openCount} outstanding.` : "Nothing outstanding."}{" "}
          Anything a week or more old is flagged.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <SearchFilter
          value={search}
          onChange={setSearch}
          placeholder="Search tasks or who they're for…"
        />
        <SegmentedFilter
          label="Relates to"
          value={kind}
          options={TASK_PARENT_KINDS}
          labels={PARENT_FILTER_LABELS}
          onChange={setKind}
        />
        <div className="flex flex-col gap-1.5">
          {/* Spacer keeps the trigger baseline-aligned with the labelled controls. */}
          <span aria-hidden className="text-xs">
            &nbsp;
          </span>
          <TaskArchiveDialog
            tasks={all}
            nowMs={nowMs}
            truncated={tasks.completedTruncated}
            keepIds={keepIds}
            onDoneChange={onDoneChange}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState bordered>
          {filtered
            ? "No tasks match your filters."
            : "Nothing assigned to you right now."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-1 rounded-md border p-3">
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
    </section>
  );
}
