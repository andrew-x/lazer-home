import { z } from "zod";
import { id } from "@/lib/id-schema";
import { manualOfMeQuestionId } from "@/lib/manual-of-me";
import { optionalTrimmedText } from "@/lib/text-schema";

/**
 * Input for upserting a single survey response. Scoped to the text-answer case
 * (all Manual of Me questions are free text): `questionId` is validated against
 * the known question ids so a crafted id can't write an arbitrary row. As more
 * surveys are added, widen `questionId` to a `z.union([...])` of their id enums
 * and add the `listResponse`/`jsonResponse` shapes here.
 */
export const upsertResponseSchema = z.object({
  staffId: id,
  questionId: manualOfMeQuestionId,
  textResponse: optionalTrimmedText(
    10_000,
    "Keep your answer under 10,000 characters.",
  ),
});

export type UpsertResponseInput = z.input<typeof upsertResponseSchema>;
