"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { feedback } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { authorizeFeedbackCreate } from "./authorizeFeedback";
import { createFeedbackSchema } from "./createFeedback.schema";

/**
 * Leave peer feedback about another active staff member. Open to any active
 * staff (no capability) — the `authorizeFeedbackCreate` hook validates the target
 * is a distinct active staff member. `fromStaffId` is the caller, resolved from
 * the session (never taken from the client).
 */
export const createFeedback = secureActionClient
  .metadata({
    action: "create-feedback",
    authorize: authorizeFeedbackCreate,
  })
  .inputSchema(createFeedbackSchema)
  .action(async ({ parsedInput }) => {
    const fromStaffId = await getCurrentStaffId();
    if (!fromStaffId) {
      throw new UserSafeActionError(
        "You need a staff profile to leave feedback.",
      );
    }

    await db.insert(feedback).values({
      id: generateId("feedback"),
      fromStaffId,
      toStaffId: parsedInput.toStaffId,
      rating: parsedInput.rating,
      context: parsedInput.context,
      keepDoing: parsedInput.keepDoing ?? null,
      stopDoing: parsedInput.stopDoing ?? null,
      startDoing: parsedInput.startDoing ?? null,
      other: parsedInput.other ?? null,
      messageToRecipient: parsedInput.messageToRecipient ?? null,
    });

    revalidatePath("/feedback");
    return { ok: true };
  });
