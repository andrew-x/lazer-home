"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { updateStaffLinksSchema } from "./updateStaffLinks.schema";

/**
 * Update a staff member's profile links by id.
 *
 * TODO: lock down to owner/admin. Any authenticated user can currently edit any
 * staff member's links — intentional for now (see the 2026-06-17 browse-staff
 * spec); `secureActionClient` still requires a valid session.
 */
export const updateStaffLinks = secureActionClient
  .metadata({ action: "update-staff-links" })
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
