"use server";

import { eq } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { tasks } from "@/lib/db/schema";
import { revalidateTaskParent } from "./taskParent";
import { deleteTaskSchema } from "./tasks.schema";

/**
 * Delete a task. Gated on `crm.edit` — any CRM editor may remove any task
 * (mirroring notes). `.returning()` confirms the row existed and yields the
 * parent FKs for revalidation.
 */
export const deleteTask = secureActionClient
  .metadata({ action: "delete-task", permission: { crm: ["edit"] } })
  .inputSchema(deleteTaskSchema)
  .action(async ({ parsedInput }) => {
    const rows = await db
      .delete(tasks)
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
