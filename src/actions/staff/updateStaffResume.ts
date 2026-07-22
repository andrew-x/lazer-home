"use server";

import { eq } from "drizzle-orm";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { authorizeStaffEdit } from "./canEditStaff";
import {
  assertStaffUpdated,
  revalidateStaffProfile,
} from "./staffProfileMutation";
import { updateStaffResumeSchema } from "./updateStaffResume.schema";

/**
 * Update a staff member's resume by id. Stamps `resumeUpdatedAt`.
 *
 * Authorization (owner always; others need `staff.edit`) is enforced by the
 * `authorizeStaffEdit` hook before this body runs.
 */
export const updateStaffResume = secureActionClient
  .metadata({ action: "update-staff-resume", authorize: authorizeStaffEdit })
  .inputSchema(updateStaffResumeSchema)
  .action(async ({ parsedInput }) => {
    const rows = await db
      .update(staff)
      .set({
        resume: parsedInput.resume,
        resumeUpdatedAt: new Date(),
      })
      .where(eq(staff.id, parsedInput.staffId))
      .returning({ id: staff.id });

    assertStaffUpdated(rows);

    revalidateStaffProfile(parsedInput.staffId);
    return { ok: true };
  });
