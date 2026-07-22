"use server";

import { authorizeStaffEdit } from "@/actions/staff/canEditStaff";
import { revalidateStaffProfile } from "@/actions/staff/staffProfileMutation";
import { secureActionClient } from "@/lib/core/action";
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
 * profile-field edit. Clearing an answer sends "" / [] → null (kept row).
 *
 * A question uses one payload shape; we write both columns explicitly (nulling
 * the unused one) so a row never carries a stale value from the other shape.
 */
export const upsertResponse = secureActionClient
  .metadata({ action: "upsert-response", authorize: authorizeStaffEdit })
  .inputSchema(upsertResponseSchema)
  .action(
    async ({
      parsedInput: { staffId, questionId, textResponse, listResponse },
    }) => {
      const text = textResponse ?? null;
      const list =
        listResponse && listResponse.length > 0 ? listResponse : null;

      await db
        .insert(responses)
        .values({
          id: generateId("response"),
          staffId,
          questionId,
          textResponse: text,
          listResponse: list,
        })
        .onConflictDoUpdate({
          target: [responses.staffId, responses.questionId],
          set: { textResponse: text, listResponse: list },
        });

      revalidateStaffProfile(staffId);
      return { ok: true };
    },
  );
