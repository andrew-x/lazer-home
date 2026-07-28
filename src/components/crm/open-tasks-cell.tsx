import type { OpenTaskSummary } from "@/actions/crm/getTasks";
import { EmptyCell } from "@/components/empty-cell";
import { TaskOwnerAvatar } from "./task-owner-avatar";

/**
 * The read-only "Next steps" cell: a compact list of a parent's open (not-done)
 * tasks — one line each, owner on the right — or an {@link EmptyCell} when there
 * are none. Used by the company detail's contacts table, and by
 * `ContactTasksCell` as its fallback for viewers without `crm.edit` (the contacts
 * list is editable in place, and matches this layout so both read the same).
 * Replaced the old next-step cell when tasks superseded next steps.
 */
export function OpenTasksCell({ tasks }: { tasks: OpenTaskSummary[] }) {
  if (tasks.length === 0) {
    return <EmptyCell />;
  }

  return (
    <ul className="flex flex-col gap-1">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs">
            {task.description}
          </span>
          <TaskOwnerAvatar name={task.ownerName} />
        </li>
      ))}
    </ul>
  );
}
