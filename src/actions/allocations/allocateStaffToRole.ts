"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { projectRoles } from "@/lib/db/schema";
import { allocateStaffToRoleSchema } from "./allocateStaffToRole.schema";

/**
 * Allocate a staff member to an existing **open** project role from the
 * allocations planner: set who fills it and apply the adjusted date range +
 * hours/day. Unlike `assignRoleStaff` (opportunity-scoped, staff-only), this is
 * the allocations-view entry point and works over any open role.
 *
 * Gated on `projects.edit`. Guards, inside the transaction, that the target is
 * still an open position in a live planning state — so a placeholder can't be
 * overwritten and two concurrent assignments can't both win.
 */
export const allocateStaffToRole = secureActionClient
  .metadata({
    action: "allocate-staff-to-role",
    permission: { projects: ["edit"] },
  })
  .inputSchema(allocateStaffToRoleSchema)
  .action(async ({ parsedInput }) => {
    const { roleId, staffId, startDate, endDate, hoursPerDay } = parsedInput;

    await db.transaction(async (tx) => {
      const [role] = await tx
        .select({
          id: projectRoles.id,
          staffId: projectRoles.staffId,
          status: projectRoles.status,
        })
        .from(projectRoles)
        .where(eq(projectRoles.id, roleId))
        .limit(1);

      if (!role) {
        throw new UserSafeActionError("That role no longer exists.");
      }
      if (role.staffId !== null) {
        throw new UserSafeActionError(
          "That role is already staffed — refresh and pick another open role.",
        );
      }
      if (role.status !== "tentative" && role.status !== "confirmed") {
        throw new UserSafeActionError(
          "That role can't be staffed in its current state.",
        );
      }

      await tx
        .update(projectRoles)
        .set({ staffId, startDate, endDate, hoursPerDay })
        .where(eq(projectRoles.id, roleId));
    });

    revalidatePath("/allocations");
    revalidatePath("/projects");
    revalidatePath("/opportunities");
    return { id: roleId };
  });
