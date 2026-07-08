"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { authorizeStaffEdit } from "./canEditStaff";
import { updateStaffSkillsSchema } from "./updateStaffSkills.schema";

/**
 * Replace a staff member's skills list by id. Authorization (own profile OR
 * `staff.edit`) is enforced by the `authorizeStaffEdit` hook before this body runs.
 */
export const updateStaffSkills = secureActionClient
  .metadata({ action: "update-staff-skills", authorize: authorizeStaffEdit })
  .inputSchema(updateStaffSkillsSchema)
  .action(async ({ parsedInput }) => {
    const [updated] = await db
      .update(staff)
      .set({ skills: parsedInput.skills })
      .where(eq(staff.id, parsedInput.staffId))
      .returning({ id: staff.id });

    if (!updated) {
      throw new UserSafeActionError("That staff profile no longer exists.");
    }

    revalidatePath("/profile");
    revalidatePath(`/staff/${parsedInput.staffId}`);
    revalidatePath(`/staff/${parsedInput.staffId}/skills`);
    return { ok: true };
  });
