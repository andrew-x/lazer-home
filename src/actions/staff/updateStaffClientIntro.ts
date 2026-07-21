"use server";

import { eq } from "drizzle-orm";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { authorizeStaffEdit } from "./canEditStaff";
import {
  assertStaffUpdated,
  revalidateStaffProfile,
} from "./staffProfileMutation";
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
    const rows = await db
      .update(staff)
      .set({
        clientIntro: parsedInput.clientIntro,
        clientIntroUpdatedAt: new Date(),
      })
      .where(eq(staff.id, parsedInput.staffId))
      .returning({ id: staff.id });

    assertStaffUpdated(rows);

    revalidateStaffProfile(parsedInput.staffId);
    return { ok: true };
  });
