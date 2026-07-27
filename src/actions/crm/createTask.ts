"use server";

import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { isForeignKeyViolation } from "@/lib/db/foreign-key-violation";
import { generateId } from "@/lib/db/ids";
import { tasks } from "@/lib/db/schema";
import { resolveAuthorStaffId } from "./resolveAuthorStaffId";
import { revalidateTaskParentByKind } from "./taskParent";
import { createTaskSchema } from "./tasks.schema";

/**
 * Create a task on a CRM parent (company/contact/opportunity). Gated on
 * `crm.edit`. The creator is resolved server-side from the session (never trusted
 * from the client); the owner defaults to that same staff id when the composer
 * doesn't pick someone else. The parent FK is guarded by the DB, so a stale id
 * surfaces as a clean error rather than a dangling row.
 */
export const createTask = secureActionClient
  .metadata({ action: "create-task", permission: { crm: ["edit"] } })
  .inputSchema(createTaskSchema)
  .action(async ({ parsedInput, ctx }) => {
    const creatorStaffId = await resolveAuthorStaffId(ctx.user);
    const taskId = generateId("task");
    const { kind, id: parentId } = parsedInput.parent;

    try {
      await db.insert(tasks).values({
        id: taskId,
        description: parsedInput.description,
        // Default the owner to the creator when the composer didn't pick one.
        ownerStaffId: parsedInput.ownerId ?? creatorStaffId,
        creatorStaffId,
        companyId: kind === "company" ? parentId : null,
        contactId: kind === "contact" ? parentId : null,
        opportunityId: kind === "opportunity" ? parentId : null,
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new UserSafeActionError(`That ${kind} no longer exists.`);
      }
      throw error;
    }

    revalidateTaskParentByKind(kind, parentId);
    return { id: taskId };
  });
