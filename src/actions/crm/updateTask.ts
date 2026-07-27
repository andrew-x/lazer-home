"use server";

import { eq } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { tasks } from "@/lib/db/schema";
import { revalidateTaskParent } from "./taskParent";
import { updateTaskSchema } from "./tasks.schema";

/**
 * Edit a task's description and owner. Gated on `crm.edit` — any CRM editor may
 * amend any task (no per-task ownership check, mirroring notes). `.returning()`
 * the parent FKs both guards against the row being deleted mid-edit and tells us
 * which parent's pages to revalidate.
 */
export const updateTask = secureActionClient
  .metadata({ action: "update-task", permission: { crm: ["edit"] } })
  .inputSchema(updateTaskSchema)
  .action(async ({ parsedInput }) => {
    const rows = await db
      .update(tasks)
      .set({
        description: parsedInput.description,
        ownerStaffId: parsedInput.ownerId,
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
