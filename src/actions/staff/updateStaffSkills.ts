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
import { updateStaffSkillsSchema } from "./updateStaffSkills.schema";

/**
 * Replace a staff member's skills list by id. Authorization (own profile OR
 * `staff.edit`) is enforced by the `authorizeStaffEdit` hook before this body runs.
 */
export const updateStaffSkills = secureActionClient
  .metadata({ action: "update-staff-skills", authorize: authorizeStaffEdit })
  .inputSchema(updateStaffSkillsSchema)
  .action(async ({ parsedInput }) => {
    const rows = await db
      .update(staff)
      .set({ skills: parsedInput.skills })
      .where(eq(staff.id, parsedInput.staffId))
      .returning({ id: staff.id });

    assertStaffUpdated(rows);

    revalidateStaffProfile(
      parsedInput.staffId,
      `/staff/${parsedInput.staffId}/skills`,
    );
    return { ok: true };
  });
