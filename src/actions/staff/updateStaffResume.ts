"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { updateStaffResumeSchema } from "./updateStaffResume.schema";

/**
 * Update a staff member's resume by id. Stamps `resumeUpdatedAt`.
 *
 * TODO: lock down to owner/admin (see the 2026-06-17 browse-staff spec).
 * `secureActionClient` still requires a valid session.
 */
export const updateStaffResume = secureActionClient
  .metadata({ action: "update-staff-resume" })
  .inputSchema(updateStaffResumeSchema)
  .action(async ({ parsedInput }) => {
    const [updated] = await db
      .update(staff)
      .set({
        resume: parsedInput.resume,
        resumeUpdatedAt: new Date(),
      })
      .where(eq(staff.id, parsedInput.staffId))
      .returning({ id: staff.id });

    if (!updated) {
      throw new UserSafeActionError("That staff profile no longer exists.");
    }

    revalidatePath("/profile");
    revalidatePath(`/staff/${parsedInput.staffId}`);
    return { ok: true };
  });
