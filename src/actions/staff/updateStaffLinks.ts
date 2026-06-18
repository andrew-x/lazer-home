"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { authorizeStaffEdit } from "./canEditStaff";
import { updateStaffLinksSchema } from "./updateStaffLinks.schema";

/**
 * Update a staff member's profile links by id. Authorization (own profile OR
 * `staff.edit`) is enforced by the `authorizeStaffEdit` hook before this body runs.
 */
export const updateStaffLinks = secureActionClient
  .metadata({ action: "update-staff-links", authorize: authorizeStaffEdit })
  .inputSchema(updateStaffLinksSchema)
  .action(async ({ parsedInput }) => {
    const [updated] = await db
      .update(staff)
      .set({
        linkedinUrl: parsedInput.linkedinUrl,
        githubUrl: parsedInput.githubUrl,
        portfolioUrl: parsedInput.portfolioUrl,
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
