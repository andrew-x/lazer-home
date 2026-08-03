import "server-only";

import { eq } from "drizzle-orm";
import { ownStaffId } from "@/actions/staff/ownStaffId";
import { userHasPermission } from "@/lib/auth/permissions";
import type { ActionAuthorize } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { taskCompletionAllowed } from "@/lib/crm/task-completion";
import { db } from "@/lib/db/db";
import { tasks } from "@/lib/db/schema";

/**
 * Can this user tick a task off? The single decision point for task completion.
 *
 * Rule: **the task's own assignee may always complete it**; completing anyone
 * else's task requires `crm.edit`. The same owner-path shape as `canEditStaff`
 * (ADR 0014) — own record always, other people's behind the capability.
 *
 * Why completion is looser than the rest of the task actions: `crm.edit` is held
 * only by sales/manager/admin, but a task can be *assigned* to anyone. Gating
 * completion on `crm.edit` meant an engineer or a finance lead could be handed a
 * task and then be unable to mark it done — the home dashboard's todo list would
 * be read-only for exactly the people whose list it is. `updateTask` and
 * `deleteTask` deliberately keep the plain `crm.edit` gate: rewording a task or
 * destroying it is editing CRM data, whereas closing out your own assignment is
 * not.
 *
 * An unknown task id is denied for anyone without `crm.edit` — the caller can't
 * own a row that isn't there, and the action body's `assertRowExists` owns the
 * not-found message.
 *
 * The decision itself is {@link taskCompletionAllowed}, a pure predicate that is
 * unit tested; this function only gathers its three inputs.
 */
export async function canCompleteTask(
  user: { id: string; role?: string | null },
  taskId: string,
): Promise<boolean> {
  const hasCrmEdit = userHasPermission(user, { crm: ["edit"] });
  // crm.edit completes any task — short-circuit before touching the db.
  if (hasCrmEdit) return true;

  // Resolved from the *passed* user, not the ambient session — same as
  // `canEditStaff`. The one caller today happens to pass the session user, but a
  // function taking a `user` must answer about that user, or a future caller
  // reusing it gets a silently wrong answer.
  const [callerStaffId, row] = await Promise.all([
    ownStaffId(user.id),
    db
      .select({ ownerStaffId: tasks.ownerStaffId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1)
      .then((rows) => rows.at(0)),
  ]);

  return taskCompletionAllowed({
    hasCrmEdit,
    ownerStaffId: row?.ownerStaffId ?? null,
    callerStaffId,
  });
}

/**
 * Action `authorize` hook (see {@link ActionAuthorize}) for completing a task:
 * gates on the input's `id`. Wire it with
 * `metadata({ authorize: authorizeTaskDone })` — `secureActionClient` runs it
 * before the body. Any action using it must take an `id: string` in its input.
 *
 * `clientInput` is raw and pre-validation, so the id is narrowed here; anything
 * that isn't a string is denied outright rather than passed to the lookup.
 */
export const authorizeTaskDone: ActionAuthorize = async ({
  user,
  clientInput,
}) => {
  const taskId = (clientInput as { id?: unknown }).id;
  if (typeof taskId !== "string" || !(await canCompleteTask(user, taskId))) {
    throw new UserSafeActionError("You don't have permission to do that.");
  }
};
