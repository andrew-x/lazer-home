"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { authorizeStaffEdit } from "./canEditStaff";
import { updateStaffClientIntroSchema } from "./updateStaffClientIntro.schema";

/**
 * Update a staff member's client intro by id. Stamps `clientIntroUpdatedAt`.
 * Authorization (own profile OR `staff.edit`) is enforced by the
 * `authorizeStaffEdit` hook before this body runs.
 */
export const updateStaffClientIntro = secureActionClient
  .metadata({
    action: "update-staff-client-intro",
    authorize: authorizeStaffEdit,
  })
  .inputSchema(updateStaffClientIntroSchema)
  .action(async ({ parsedInput }) => {
    const [updated] = await db
      .update(staff)
      .set({
        clientIntro: parsedInput.clientIntro,
        clientIntroUpdatedAt: new Date(),
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
