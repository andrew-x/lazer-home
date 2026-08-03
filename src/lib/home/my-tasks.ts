/**
 * The home dashboard's personal todo list — search, parent-kind and status
 * narrowing, plus the staleness rule. A pure, client-importable module (no
 * `db`/drizzle, no React), alongside `org-status.ts` and `my-work.ts`.
 *
 * It lives here because the panel and the archive dialog filter *identically*:
 * two copies of a substring match would drift the moment one of them learned to
 * search a new field.
 */

import type { MyTaskView } from "@/actions/crm/getMyTasks";
import type { TaskParentKind } from "@/actions/crm/tasks.schema";

/** A task open this long without being completed gets flagged. */
export const STALE_TASK_DAYS = 7;

/**
 * How many completed tasks `getMyTasks` carries. A person's *open* tasks are
 * bounded by their own behaviour, but completed ones accumulate forever — and the
 * payload crosses into a Client Component, so the history is capped and the
 * truncation is reported rather than hidden.
 *
 * It lives in this pure module rather than beside the read because the archive
 * dialog quotes the number back to the user, and a `"server-only"` module can't
 * be imported from a Client Component.
 */
export const ARCHIVE_LIMIT = 200;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days between when a task was assigned and now. Never negative. */
export function taskAgeDays(createdAt: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - createdAt) / MS_PER_DAY));
}

/**
 * Has this task been sitting too long? **Open tasks only** — a completed task is
 * never stale however old it is, because the flag means "this needs attention",
 * not "this is old". Without that the archive would light up amber end to end.
 */
export function isStaleTask(task: MyTaskView, nowMs: number): boolean {
  if (task.done) return false;
  return taskAgeDays(task.createdAt, nowMs) >= STALE_TASK_DAYS;
}

/**
 * Fold the read's two lists into one, newest-assigned first — the order the todo
 * list and the archive both render in. The two inputs can't overlap (one is
 * `done = false`, the other `done = true`), but they're deduplicated by id anyway
 * so a future read that widens either query can't produce a doubled row.
 */
export function mergeMyTasks(
  open: readonly MyTaskView[],
  completed: readonly MyTaskView[],
): MyTaskView[] {
  const byId = new Map<string, MyTaskView>();
  for (const task of [...open, ...completed]) byId.set(task.id, task);
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Re-project tasks whose done-state was toggled during this visit.
 *
 * A toggle is followed by `router.refresh()`, which is asynchronous — so for a
 * moment the server list still disagrees with what the person just clicked.
 * Overriding here (rather than in each component's render) means the *whole*
 * pipeline — the status filter, the staleness flag, the strike-through — sees one
 * consistent done-state instead of three views disagreeing.
 *
 * Reopening also clears `completedAt`: leaving it set would make a reopened task
 * render "Done <date>" until the refresh landed.
 */
export function applyDoneOverrides(
  tasks: readonly MyTaskView[],
  overrides: ReadonlyMap<string, boolean>,
): MyTaskView[] {
  if (overrides.size === 0) return [...tasks];
  return tasks.map((task) => {
    const done = overrides.get(task.id);
    if (done === undefined || done === task.done) return task;
    return { ...task, done, completedAt: done ? task.completedAt : null };
  });
}

/** Which completion states to show. `all` keeps both. */
export type TaskStatusFilter = "all" | "open" | "completed";

export type MyTaskFilters = {
  /** Free text, matched against the description *and* the parent's name. */
  query?: string;
  /** Narrow to one kind of CRM parent; omit (or null) for all three. */
  kind?: TaskParentKind | null;
  status?: TaskStatusFilter;
  /**
   * Tasks to hold in the list even though `status` would drop them — the ids
   * toggled during this visit.
   *
   * This is what makes "ticking a task off doesn't hide it" work. Both surfaces
   * filter by a status the toggle immediately contradicts (the panel shows open
   * tasks; the archive defaults to completed ones), so without this a tick would
   * make the row vanish from under the cursor — and the next reflexive click would
   * land on whichever row shifted up into its place.
   *
   * It exempts a row from the **status** filter only. Search text and parent kind
   * still apply: a kept row that no longer matches what you typed should hide,
   * because that's you narrowing the list, not the list moving on its own.
   */
  keepIds?: ReadonlySet<string>;
};

/**
 * Narrow a list of tasks by search text, parent kind and completion state.
 *
 * The text match covers the parent name as well as the description, so "Acme"
 * finds every task hanging off Acme without the person having to remember how
 * they worded it. Case-insensitive substring — no fuzzy matching, matching the
 * other in-memory filters in the app (`staff-directory`).
 */
export function filterMyTasks(
  tasks: readonly MyTaskView[],
  { query = "", kind = null, status = "all", keepIds }: MyTaskFilters = {},
): MyTaskView[] {
  const needle = query.trim().toLowerCase();

  return tasks.filter((task) => {
    if (!keepIds?.has(task.id)) {
      if (status === "open" && task.done) return false;
      if (status === "completed" && !task.done) return false;
    }
    if (kind && task.parentKind !== kind) return false;
    if (
      needle &&
      !task.description.toLowerCase().includes(needle) &&
      !task.parentName.toLowerCase().includes(needle)
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Order the archive: most recently *finished* first, falling back to when a task
 * was assigned for anything still open.
 *
 * Deliberately a different key from {@link mergeMyTasks}, which the panel uses.
 * The archive answers "what did I close out, and when", so a long-standing task
 * completed yesterday belongs at the top — sorting it by assignment date would
 * bury it among newer-but-older-finished rows, and would also disagree with the
 * `ARCHIVE_LIMIT` window, which the read selects by completion date. The panel
 * keeps the assignment-date order so that ticking a task doesn't make the row jump
 * position under the cursor.
 */
export function sortMyTasksByRecency(
  tasks: readonly MyTaskView[],
): MyTaskView[] {
  return [...tasks].sort(
    (a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt),
  );
}
