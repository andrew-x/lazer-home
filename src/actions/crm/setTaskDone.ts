"use server";

import { eq } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { tasks } from "@/lib/db/schema";
import { authorizeTaskDone } from "./canCompleteTask";
import { revalidateTaskParent } from "./taskParent";
import { setTaskDoneSchema } from "./tasks.schema";

/**
 * Toggle a task's completion. Gated by {@link authorizeTaskDone}: the task's own
 * assignee may always complete it, anyone else needs `crm.edit` — see
 * `canCompleteTask` for why this one action is looser than `updateTask` /
 * `deleteTask`. `completedAt` is stamped when `done` flips true and cleared back
 * to null when the task is reopened, so the completion date always tracks the
 * flag. `.returning()` the parent FKs guards the row and drives revalidation.
 */
export const setTaskDone = secureActionClient
  .metadata({ action: "set-task-done", authorize: authorizeTaskDone })
  .inputSchema(setTaskDoneSchema)
  .action(async ({ parsedInput }) => {
    const rows = await db
      .update(tasks)
      .set({
        done: parsedInput.done,
        completedAt: parsedInput.done ? new Date() : null,
      })
      .where(eq(tasks.id, parsedInput.id))
      .returning({
        companyId: tasks.companyId,
        contactId: tasks.contactId,
        opportunityId: tasks.opportunityId,
      });
    assertRowExists(rows, "task");

    revalidateTaskParent(rows[0]);
    return { id: parsedInput.id };
  });
