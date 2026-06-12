"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staffProfile } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { updateStaffProfileSchema } from "./updateStaffProfile.schema";

/**
 * Example secure action demonstrating the full chain. Note the TWO authz layers:
 *   1. route-level — `secureActionClient` + metadata (add `role: "admin"` to gate)
 *   2. row-level   — the ownership check inside the body
 */
export const updateStaffProfile = secureActionClient
  .metadata({ action: "update-staff-profile" })
  .inputSchema(updateStaffProfileSchema)
  .action(async ({ ctx: { user }, parsedInput: { id, ...values } }) => {
    const existing = await db.query.staffProfile.findFirst({
      where: eq(staffProfile.id, id),
    });
    if (!existing) throw new UserSafeActionError("Staff profile not found.");

    // Row-level authz: owners and admins only.
    if (existing.userId !== user.id && user.role !== "admin") {
      throw new UserSafeActionError("You can only edit your own profile.");
    }

    const [updated] = await db
      .update(staffProfile)
      .set(values)
      .where(eq(staffProfile.id, id))
      .returning();

    revalidatePath("/");
    return { staffProfile: updated };
  });
