import type { OpenTaskSummary } from "@/actions/crm/getTasks";
import { EmptyCell } from "@/components/empty-cell";

/**
 * The "Tasks" cell shared by the contacts list and the company detail's contacts
 * table: a compact list of a contact's open (not-done) tasks, each clamped to one
 * line, or an {@link EmptyCell} when there are none. Replaced the old next-step
 * cell when tasks superseded next steps.
 */
export function OpenTasksCell({ tasks }: { tasks: OpenTaskSummary[] }) {
  if (tasks.length === 0) {
    return <EmptyCell />;
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {tasks.map((task) => (
        <li key={task.id} className="line-clamp-1">
          {task.description}
        </li>
      ))}
    </ul>
  );
}
