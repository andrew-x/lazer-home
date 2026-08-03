"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import type { MyTaskView } from "@/actions/crm/getMyTasks";
import { setTaskDone } from "@/actions/crm/setTaskDone";
import { InternalLink } from "@/components/internal-link";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/core/utils";
import { TASK_PARENT_LABELS, taskParentHref } from "@/lib/crm/task-parent-link";
import { formatShortDate } from "@/lib/format/format";
import { isStaleTask, taskAgeDays } from "@/lib/home/my-tasks";

/**
 * One task on the home dashboard's todo list: a checkbox, the description, and a
 * meta line saying what it relates to and when it was assigned. Shared by the
 * panel and the archive dialog so ticking off behaves identically in both.
 *
 * Each row owns its own action hook deliberately: `useAction` keeps a single
 * in-flight request id and drops the result of any superseded call, so a
 * list-wide hook shared by every row would swallow the first task's error (and
 * clear its pending state) the moment you touched a second one. Same reasoning as
 * `crm/contact-tasks-cell.tsx`.
 *
 * `nowMs` is passed down from the server rather than read here, so the staleness
 * calculation is identical on both sides of hydration.
 */
export function MyTaskRow({
  task,
  done,
  nowMs,
  onDoneChange,
}: {
  task: MyTaskView;
  /** The done state to render — the caller owns it, so a just-ticked row can persist. */
  done: boolean;
  nowMs: number;
  /** Hands the toggled task back so the list can keep rendering it as an undo. */
  onDoneChange: (task: MyTaskView, done: boolean) => void;
}) {
  const router = useRouter();

  const toggle = useAction(setTaskDone, {
    onSuccess: () => {
      onDoneChange(task, !done);
      router.refresh();
    },
    // A dense list row has no room for inline error text.
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Something went wrong."),
  });

  // Show the destination state while the toggle is in flight, so the tick and the
  // strike-through land on click rather than after the round-trip.
  const struck = toggle.isPending ? !done : done;
  // Staleness follows the rendered state: un-ticking an old task should bring the
  // flag straight back, not wait for the server round-trip.
  const stale = isStaleTask({ ...task, done: struck }, nowMs);
  const ageDays = taskAgeDays(task.createdAt, nowMs);

  return (
    <li
      className={cn(
        "flex items-start gap-2.5 border-l-2 py-1.5 pl-3",
        stale && "border-l-amber-400",
      )}
    >
      <Checkbox
        checked={struck}
        onCheckedChange={() => toggle.execute({ id: task.id, done: !done })}
        disabled={toggle.isPending}
        aria-label={
          done
            ? `Reopen "${task.description}"`
            : `Complete "${task.description}"`
        }
        className="mt-0.5 shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p
          className={cn(
            "whitespace-pre-wrap text-sm",
            struck && "text-muted-foreground line-through",
          )}
        >
          {task.description}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{TASK_PARENT_LABELS[task.parentKind]}</span>
          <InternalLink href={taskParentHref(task.parentKind, task.parentId)}>
            {task.parentName}
          </InternalLink>
          <span>·</span>
          <span>
            {done && task.completedAt
              ? `Done ${formatShortDate(new Date(task.completedAt))}`
              : `Assigned ${formatShortDate(new Date(task.createdAt))}`}
          </span>
          {/* Label the highlight rather than leaving it as unexplained colour. */}
          {stale ? (
            <>
              <span>·</span>
              <span className="font-medium text-amber-900">
                {ageDays} days old
              </span>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}
