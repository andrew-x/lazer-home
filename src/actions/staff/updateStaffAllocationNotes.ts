"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { assertStaffUpdated } from "./staffProfileMutation";
import { updateStaffAllocationNotesSchema } from "./updateStaffAllocationNotes.schema";

/**
 * Update a staff member's allocation notes by id — the planner's inline,
 * debounced editor.
 *
 * Gated by the static `staff.edit` capability (managers/admins), NOT the
 * owner-or-`staff.edit` `authorizeStaffEdit` hook the profile fields use: these
 * are cross-person staffing notes on a management planner, so a person editing
 * only their own row isn't the intent. The notes are also read-gated on
 * `staff.edit` in `getAllocationsGrid`, so they never reach an unprivileged
 * client. Revalidates `/allocations` — the only page that shows the field.
 */
export const updateStaffAllocationNotes = secureActionClient
  .metadata({
    action: "update-staff-allocation-notes",
    permission: { staff: ["edit"] },
  })
  .inputSchema(updateStaffAllocationNotesSchema)
  .action(async ({ parsedInput }) => {
    const rows = await db
      .update(staff)
      .set({ allocationNotes: parsedInput.allocationNotes })
      .where(eq(staff.id, parsedInput.staffId))
      .returning({ id: staff.id });

    assertStaffUpdated(rows);

    revalidatePath("/allocations");
    return { ok: true };
  });
