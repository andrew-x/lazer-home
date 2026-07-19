import { z } from "zod";
import { id } from "@/lib/id-schema";
import { manualOfMeQuestionId } from "@/lib/manual-of-me";
import { optionalTrimmedText } from "@/lib/text-schema";
import { waysOfWorkingQuestionId } from "@/lib/ways-of-working";

/**
 * Input for upserting a single survey response. `questionId` is validated
 * against the union of every survey's known ids so a crafted id can't write an
 * arbitrary row. A question uses exactly one payload shape: free-text /
 * single-select answers send `textResponse`; multi-selects and matrix buckets
 * send `listResponse`. Both are optional here (a given question sends one); the
 * action nulls out the one that isn't used so each row stays single-shaped.
 *
 * As more surveys are added, extend the `questionId` union with their id enums.
 */
export const upsertResponseSchema = z.object({
  staffId: id,
  questionId: z.union([manualOfMeQuestionId, waysOfWorkingQuestionId]),
  textResponse: optionalTrimmedText(
    10_000,
    "Keep your answer under 10,000 characters.",
  ).optional(),
  // Multi-select answers. Each entry comes from a fixed option list; caps guard
  // against a crafted oversized payload.
  listResponse: z.array(z.string().max(200)).max(200).optional(),
});

export type UpsertResponseInput = z.input<typeof upsertResponseSchema>;
