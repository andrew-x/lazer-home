"use server";

import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { isForeignKeyViolation } from "@/lib/db/foreign-key-violation";
import { generateId } from "@/lib/db/ids";
import { companyEntries } from "@/lib/db/schema";
import { addCompanyEntrySchema } from "./entries.schema";
import { resolveAuthorStaffId } from "./resolveAuthorStaffId";

/**
 * Append a timestamped note entry to a company's log. Gated on `crm.edit`. The
 * author is resolved server-side from the session (never trusted from the
 * client); `createdAt` defaults to now. The company FK is guarded by the DB — a
 * bad id surfaces as a clean error rather than a dangling row.
 */
export const addCompanyEntry = secureActionClient
  .metadata({ action: "add-company-entry", permission: { crm: ["edit"] } })
  .inputSchema(addCompanyEntrySchema)
  .action(async ({ parsedInput, ctx }) => {
    const authorStaffId = await resolveAuthorStaffId(ctx.user);
    const entryId = generateId("coentry");
    try {
      await db.insert(companyEntries).values({
        id: entryId,
        companyId: parsedInput.companyId,
        kind: parsedInput.kind,
        body: parsedInput.body,
        authorStaffId,
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new UserSafeActionError("That company no longer exists.");
      }
      throw error;
    }

    revalidatePath(`/companies/${parsedInput.companyId}`);
    revalidatePath("/companies");
    return { id: entryId };
  });
