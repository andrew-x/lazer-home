"use server";

import { revalidatePath } from "next/cache";
import { authorizeStaffEdit } from "@/actions/staff/canEditStaff";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { responses } from "@/lib/db/schema";
import { upsertResponseSchema } from "./upsertResponse.schema";

/**
 * Create or update one person's answer to a single survey question. Keyed on
 * (staffId, questionId) — the unique constraint makes this an idempotent upsert,
 * so the guided editor can save each question independently and re-save freely.
 *
 * Gated by `authorizeStaffEdit` (own profile always; others need `staff.edit`),
 * which reads `staffId` off the input — the same boundary as every other
 * profile-field edit. Clearing an answer sends "" → null (kept row).
 */
export const upsertResponse = secureActionClient
  .metadata({ action: "upsert-response", authorize: authorizeStaffEdit })
  .inputSchema(upsertResponseSchema)
  .action(async ({ parsedInput: { staffId, questionId, textResponse } }) => {
    await db
      .insert(responses)
      .values({ id: generateId("response"), staffId, questionId, textResponse })
      .onConflictDoUpdate({
        target: [responses.staffId, responses.questionId],
        set: { textResponse },
      });

    revalidatePath("/profile");
    revalidatePath(`/staff/${staffId}`);
    return { ok: true };
  });
