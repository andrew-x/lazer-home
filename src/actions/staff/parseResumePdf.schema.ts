import { z } from "zod";

/**
 * A PDF to extract resume text from. `fileBase64` is the raw PDF bytes,
 * base64-encoded with no `data:` prefix. ~8 MB of base64 ≈ a ~6 MB PDF, which
 * sits under the configured server-action body limit; reject anything larger
 * server-side as a backstop to the client's own size check.
 */
export const parseResumePdfSchema = z.object({
  fileBase64: z
    .string()
    .min(1, "No file provided.")
    .max(8_000_000, "That PDF is too large. Keep it under ~6 MB."),
});
